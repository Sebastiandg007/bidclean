import { DataSource } from 'typeorm';
import { SubscriptionsRepository } from '../subscriptions.repository';
import {
  DispatchStatus,
  EntitlementDelta,
  EntitlementKey,
  Store,
} from '../subscriptions.types';
import { InMemoryDataSource } from './support/in-memory-data-source';

/**
 * Unit tests for SubscriptionsRepository invariants over an in-memory DataSource fake.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.3 (dedup), 2.7/2.8 (per-entitlement ordering + idempotence),
 * 2.9 (TRANSFER atomic both-rows), 8.1 (deletion cleanup), P15.
 */

function delta(overrides: Partial<EntitlementDelta>): EntitlementDelta {
  return {
    userId: 'user-1',
    entitlementKey: EntitlementKey.CLEANER_PRO,
    active: true,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    store: Store.APP_STORE,
    eventTimestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SubscriptionsRepository', () => {
  let fake: InMemoryDataSource;
  let repo: SubscriptionsRepository;

  beforeEach(() => {
    fake = new InMemoryDataSource();
    repo = new SubscriptionsRepository(fake as unknown as DataSource);
  });

  describe('dedup', () => {
    it('reports a processed event and rejects a duplicate append', async () => {
      const id = await repo.appendEvent(baseEvent('evt-1'));
      expect(id).not.toBeNull();
      await expect(repo.hasProcessedEvent('evt-1')).resolves.toBe(true);

      const duplicate = await repo.appendEvent(baseEvent('evt-1'));
      expect(duplicate).toBeNull(); // unique violation swallowed -> redelivery
    });
  });

  describe('applyDeltas — per-entitlement ordering', () => {
    it('applies a newer delta and ignores an older one for the same entitlement', async () => {
      await repo.applyDeltas([delta({ eventTimestampMs: 2000, active: true })], null);
      await repo.applyDeltas([delta({ eventTimestampMs: 1000, active: false })], null);

      const row = await repo.findByUserId('user-1');
      expect(row?.cleanerProActive).toBe(true); // stale (older) event did not overwrite
    });

    it('does not let a newer event for B suppress a valid event for A (P15)', async () => {
      await repo.applyDeltas([delta({ entitlementKey: EntitlementKey.HOST_PRO, eventTimestampMs: 5000, active: true })], null);
      // A late-but-valid cleaner_pro event (older than the host_pro one) must still apply.
      await repo.applyDeltas([delta({ entitlementKey: EntitlementKey.CLEANER_PRO, eventTimestampMs: 3000, active: true })], null);

      const row = await repo.findByUserId('user-1');
      expect(row?.hostProActive).toBe(true);
      expect(row?.cleanerProActive).toBe(true);
    });
  });

  describe('applyDeltas — TRANSFER', () => {
    it('removes the entitlement from the source and grants it to the destination atomically', async () => {
      // Seed the source as active.
      await repo.applyDeltas([delta({ userId: 'src', entitlementKey: EntitlementKey.HOST_PRO, eventTimestampMs: 1000, active: true })], null);

      const transfer = delta({
        userId: 'src',
        transferToUserId: 'dst',
        entitlementKey: EntitlementKey.HOST_PRO,
        active: false,
        eventTimestampMs: 2000,
      });
      await repo.applyDeltas([transfer], null);

      const source = await repo.findByUserId('src');
      const destination = await repo.findByUserId('dst');
      expect(source?.hostProActive).toBe(false);
      expect(destination?.hostProActive).toBe(true);
    });
  });

  describe('dispatch lifecycle', () => {
    it('marks a ledger row PROCESSED when applyDeltas is given its id', async () => {
      const id = await repo.appendEvent(baseEvent('evt-2'));
      await repo.applyDeltas([delta({})], id);
      const events = fake.events.filter((e) => e.id === id);
      expect(events[0]?.dispatchStatus).toBe(DispatchStatus.PROCESSED);
    });

    it('recovers RECEIVED rows older than the grace window', async () => {
      const id = await repo.appendEvent(baseEvent('evt-3'));
      // Age the row beyond the grace window.
      const row = fake.events.find((e) => e.id === id);
      if (row) {
        row.createdAt = new Date(Date.now() - 120_000);
      }
      const recovered = await repo.findRecovered(60_000, 10);
      expect(recovered.map((r) => r.id)).toContain(id);
    });
  });

  describe('deletion cleanup', () => {
    it('removes the mirror row and anonymizes the ledger for a user', async () => {
      await repo.applyDeltas([delta({ userId: 'user-9' })], null);
      await repo.appendEvent(baseEvent('evt-9', 'user-9'));

      await repo.removeForUser('user-9');
      await repo.anonymizeLedgerForUser('user-9');

      expect(await repo.findByUserId('user-9')).toBeNull();
      const ledger = fake.events.filter((e) => e.revenuecatEventId === 'evt-9');
      expect(ledger[0]?.userId).toBeNull(); // history survives, anonymized
    });
  });

  describe('discovery', () => {
    it('returns only candidate users without a mirror row', async () => {
      await repo.applyDeltas([delta({ userId: 'has-row' })], null);
      const missing = await repo.findUserIdsMissingMirror(['has-row', 'no-row-1', 'no-row-2']);
      expect(missing.sort()).toEqual(['no-row-1', 'no-row-2']);
    });
  });
});

function baseEvent(revenuecatEventId: string, userId = 'user-1') {
  return {
    revenuecatEventId,
    userId,
    eventType: 'RENEWAL',
    entitlementIds: ['cleaner_pro'],
    store: Store.APP_STORE,
    eventTimestampMs: 1_700_000_000_000,
    expirationAt: new Date(Date.now() + 86_400_000),
    payload: { id: revenuecatEventId },
  };
}

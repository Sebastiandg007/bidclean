import * as fc from 'fast-check';
import { NotificationCategory, NotificationIntent, NotificationType } from '../notifications.types';
import { NotificationService } from '../notification.service';
import { NotificationsRepository, InsertLedgerParams } from '../notifications.repository';
import { NotificationTypeRegistry } from '../notification-type.registry';
import { PreferenceService } from '../preference.service';
import { Notification } from '../entities/notification.entity';

/**
 * Property-based test (fast-check, >=100 iters) for exactly-once intent.
 *
 * Feature: push-notifications, Property 3: Exactly-once intent under redelivery and races
 * Validates: Requirements 2.2, 2.3, 7.5
 *
 * A fake repository models the ledger's UNIQUE(dedup_key): the first insert for a key returns a
 * fresh id, every subsequent insert returns null (unique-violation no-op). We relay the same event
 * N times, sequentially and interleaved, and assert exactly one ledger row per dedup_key.
 */

interface FakeRow extends InsertLedgerParams {
  id: string;
}

class FakeRepo {
  readonly byDedup = new Map<string, FakeRow>();
  private seq = 0;

  async hasConsentedDevice(): Promise<boolean> {
    return true;
  }
  async findPreferences(): Promise<null> {
    return null;
  }
  async insertLedger(params: InsertLedgerParams): Promise<string | null> {
    if (this.byDedup.has(params.dedupKey)) {
      return null; // unique violation -> no-op
    }
    const id = `ledger-${this.seq++}`;
    this.byDedup.set(params.dedupKey, { ...params, id });
    return id;
  }
  async findLedgerByDedupKey(dedupKey: string): Promise<Notification | null> {
    const row = this.byDedup.get(dedupKey);
    return row ? ({ id: row.id } as Notification) : null;
  }
}

function makeService(repo: FakeRepo): NotificationService {
  const queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as import('bullmq').Queue;
  return new NotificationService(
    repo as unknown as NotificationsRepository,
    new NotificationTypeRegistry(),
    new PreferenceService(),
    queue,
  );
}

const intentArb: fc.Arbitrary<NotificationIntent> = fc.record({
  recipientUserId: fc.uuid(),
  type: fc.constant(NotificationType.OFFER_MATCHED),
  category: fc.constant(NotificationCategory.OFFERS),
  dedupKey: fc.uuid(),
  deepLink: fc.record({ type: fc.constant('offer_matched'), offerId: fc.uuid() }),
  priority: fc.constant('HIGH' as const),
  payloadRef: fc.record({ offerId: fc.uuid() }),
});

describe('NotificationService.createIntent — exactly-once intent', () => {
  it('Property 3: N redeliveries of one event create at most one ledger row', async () => {
    // Feature: push-notifications, Property 3: Exactly-once intent under redelivery and races
    await fc.assert(
      fc.asyncProperty(intentArb, fc.integer({ min: 1, max: 10 }), async (intent, redeliveries) => {
        const repo = new FakeRepo();
        const service = makeService(repo);

        const ids: Array<string | null> = [];
        for (let i = 0; i < redeliveries; i++) {
          ids.push(await service.createIntent(intent));
        }

        // Exactly one ledger row exists for this dedup key.
        expect(repo.byDedup.size).toBe(1);
        // Every call returns the same (single) ledger id — never a second intent.
        const distinct = new Set(ids.filter((id): id is string => id !== null));
        expect(distinct.size).toBe(1);
      }),
      { numRuns: 150 },
    );
  });

  it('Property 3: concurrent (interleaved) relays still yield one row', async () => {
    // Feature: push-notifications, Property 3: Exactly-once intent under redelivery and races
    await fc.assert(
      fc.asyncProperty(intentArb, fc.integer({ min: 2, max: 8 }), async (intent, workers) => {
        const repo = new FakeRepo();
        const service = makeService(repo);

        await Promise.all(
          Array.from({ length: workers }, () => service.createIntent(intent)),
        );

        expect(repo.byDedup.size).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

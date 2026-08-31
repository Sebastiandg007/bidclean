import * as fc from 'fast-check';
import { DataSource } from 'typeorm';
import {
  computeSignature,
  verifyWebhook,
  type WebhookAuthConfig,
} from '../revenuecat/revenuecat-signature';
import { sanitizeRevenueCatEvent } from '../revenuecat/revenuecat-payload.sanitizer';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { EntitlementDelta, EntitlementKey, Store } from '../subscriptions.types';
import { InMemoryDataSource } from './support/in-memory-data-source';

/**
 * Property-based tests (fast-check) for webhook authenticity, ingestion, and durability.
 *
 * Feature: revenuecat-subscriptions
 * Covers:
 * - Property 3: Webhook Authenticity (Requirements 2.2)
 * - Property 4: Idempotent Ingestion (Requirements 2.8)
 * - Property 5: Out-of-Order Convergence, same entitlement (Requirements 2.7)
 * - Property 9: No Sensitive Persistence (Requirements 2.4, 3.4)
 * - Property 13: Transfer Integrity (Requirements 2.9)
 * - Property 15: Per-Entitlement Ordering (Requirements 2.7)
 * - Property 16: Webhook Durability (Requirements 2.5)
 */

const NUM_RUNS = 200;

const AUTH: WebhookAuthConfig = {
  signingSecret: 'property-signing-secret',
  authSecret: '',
  toleranceSeconds: 300,
};

function buildRepo(): { repo: SubscriptionsRepository; fake: InMemoryDataSource } {
  const fake = new InMemoryDataSource();
  return { repo: new SubscriptionsRepository(fake as unknown as DataSource), fake };
}

function delta(overrides: Partial<EntitlementDelta>): EntitlementDelta {
  return {
    userId: 'user-1',
    entitlementKey: EntitlementKey.CLEANER_PRO,
    active: true,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    store: Store.APP_STORE,
    eventTimestampMs: 1_000,
    ...overrides,
  };
}

describe('webhook signature — properties', () => {
  const NOW = 1_700_000_000_000;

  it('P3: a correctly-signed, fresh request is always accepted', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: -299_000, max: 299_000 }), (body, skewMs) => {
        const timestamp = String(NOW + skewMs);
        const signature = computeSignature(body, timestamp, AUTH.signingSecret);
        const result = verifyWebhook(
          { rawBody: body, signatureHeader: signature, timestampHeader: timestamp, authorizationHeader: null },
          AUTH,
          NOW,
        );
        expect(result.ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P3: any body tampering after signing is always rejected', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (body, extra) => {
        const timestamp = String(NOW);
        const signature = computeSignature(body, timestamp, AUTH.signingSecret);
        const result = verifyWebhook(
          { rawBody: body + extra, signatureHeader: signature, timestampHeader: timestamp, authorizationHeader: null },
          AUTH,
          NOW,
        );
        expect(result.ok).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P3: a timestamp beyond tolerance is always rejected', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 301_000, max: 10_000_000 }),
        fc.boolean(),
        (body, beyondMs, future) => {
          const skew = future ? beyondMs : -beyondMs;
          const timestamp = String(NOW + skew);
          const signature = computeSignature(body, timestamp, AUTH.signingSecret);
          const result = verifyWebhook(
            { rawBody: body, signatureHeader: signature, timestampHeader: timestamp, authorizationHeader: null },
            AUTH,
            NOW,
          );
          expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('payload sanitizer — properties', () => {
  it('P9: sensitive fields never survive sanitization', () => {
    // Distinctive secret tokens (a fixed prefix + hex) so a counterexample means a real leak,
    // not an incidental collision with structural JSON characters.
    const secretArb = fc.hexaString({ minLength: 8, maxLength: 24 }).map((h) => `SECRET_${h}`);
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }),
          secret: secretArb,
          token: secretArb,
        }),
        ({ id, secret, token }) => {
          const raw = {
            event: {
              id,
              type: 'RENEWAL',
              app_user_id: 'user-1',
              entitlement_ids: ['cleaner_pro'],
              fetch_token: token,
              original_transaction_id: secret,
              subscriber_attributes: { email: `${secret}@x.com` },
            },
          };
          const serialized = JSON.stringify(sanitizeRevenueCatEvent(raw));
          expect(serialized).not.toContain(token);
          expect(serialized).not.toContain(secret);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('repository ingestion — properties', () => {
  it('P4: appending the same event id twice never creates two ledger rows', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (eventId) => {
        const { repo, fake } = buildRepo();
        const params = {
          revenuecatEventId: eventId,
          userId: 'user-1',
          eventType: 'RENEWAL',
          entitlementIds: ['cleaner_pro'],
          store: Store.APP_STORE,
          eventTimestampMs: 1_000,
          expirationAt: null,
          payload: { id: eventId },
        };
        const first = await repo.appendEvent(params);
        const second = await repo.appendEvent(params);
        expect(first).not.toBeNull();
        expect(second).toBeNull();
        expect(fake.events).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it('P5/P15: the newest event per entitlement always wins regardless of arrival order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ ts: fc.integer({ min: 1, max: 1_000_000 }), active: fc.boolean() }), {
          minLength: 1,
          maxLength: 12,
        }),
        async (events) => {
          const { repo } = buildRepo();
          // Apply in the given (arbitrary) order.
          for (const e of events) {
            await repo.applyDeltas([delta({ eventTimestampMs: e.ts, active: e.active })], null);
          }
          const row = await repo.findByUserId('user-1');
          // Expected: the state of the event with the maximum timestamp.
          const winner = events.reduce((a, b) => (b.ts >= a.ts ? b : a));
          expect(row?.cleanerProActive).toBe(winner.active);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('P15: a late event for entitlement A is never dropped by a newer event for B', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (cleanerTs, hostTs) => {
          const { repo } = buildRepo();
          // Apply host first (possibly newer), then a cleaner event (possibly older).
          await repo.applyDeltas([delta({ entitlementKey: EntitlementKey.HOST_PRO, eventTimestampMs: hostTs, active: true })], null);
          await repo.applyDeltas([delta({ entitlementKey: EntitlementKey.CLEANER_PRO, eventTimestampMs: cleanerTs, active: true })], null);
          const row = await repo.findByUserId('user-1');
          // Both must be applied — the cleaner event is judged only against cleaner's own history.
          expect(row?.hostProActive).toBe(true);
          expect(row?.cleanerProActive).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('P13: after a TRANSFER, the entitlement is on the destination only', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }),
        async (seedTs) => {
          const { repo } = buildRepo();
          await repo.applyDeltas(
            [delta({ userId: 'src', entitlementKey: EntitlementKey.HOST_PRO, eventTimestampMs: seedTs, active: true })],
            null,
          );
          await repo.applyDeltas(
            [delta({ userId: 'src', transferToUserId: 'dst', entitlementKey: EntitlementKey.HOST_PRO, eventTimestampMs: seedTs + 1, active: false })],
            null,
          );
          const src = await repo.findByUserId('src');
          const dst = await repo.findByUserId('dst');
          expect(src?.hostProActive).toBe(false);
          expect(dst?.hostProActive).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('P16: an acknowledged (RECEIVED) event past grace is always recoverable', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (eventId) => {
        const { repo, fake } = buildRepo();
        const id = await repo.appendEvent({
          revenuecatEventId: eventId,
          userId: 'user-1',
          eventType: 'RENEWAL',
          entitlementIds: ['cleaner_pro'],
          store: Store.APP_STORE,
          eventTimestampMs: 1_000,
          expirationAt: null,
          payload: { id: eventId },
        });
        // Age it beyond grace (enqueue never happened -> still RECEIVED).
        const row = fake.events.find((e) => e.id === id);
        if (row) {
          row.createdAt = new Date(Date.now() - 120_000);
        }
        const recovered = await repo.findRecovered(60_000, 50);
        expect(recovered.map((r) => r.id)).toContain(id);
      }),
      { numRuns: 100 },
    );
  });
});

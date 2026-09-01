import * as fc from 'fast-check';
import { DataSource } from 'typeorm';
import { SubscriptionReconciliationService } from '../reconciliation/subscription-reconciliation.service';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { RevenueCatClient, type RevenueCatSubscriber } from '../revenuecat/revenuecat.client';
import { EntitlementKey, Store } from '../subscriptions.types';
import { InMemoryDataSource } from './support/in-memory-data-source';

/**
 * Property-based tests (fast-check) for reconciliation convergence, discovery, and degradation.
 *
 * Feature: revenuecat-subscriptions
 * Covers:
 * - Property 6: Reconciliation Convergence (Requirements 4.1, 4.3)
 * - Property 8: Safe Degradation (Requirements 1.6, 8.3)
 * - Property 18: Reconciliation Discovers Missing Subscribers (Requirements 4.6)
 *
 * Property 7 (Server Authority) and Property 14 (Purchase-Window Determinism) are structural:
 * the tier resolver + `/subscriptions/me` read ONLY the mirror, and the mobile store converges
 * via a server refresh (covered by useSubscription.spec). Property 10 (Configuration Integrity)
 * is covered by subscriptions.config.property.spec.
 */

const NUM_RUNS = 150;

function build(): {
  service: SubscriptionReconciliationService;
  repo: SubscriptionsRepository;
  fake: InMemoryDataSource;
  setSubscriber: (fn: (userId: string) => RevenueCatSubscriber | null) => void;
} {
  const fake = new InMemoryDataSource();
  const repo = new SubscriptionsRepository(fake as unknown as DataSource);
  let resolver: (userId: string) => RevenueCatSubscriber | null = () => null;
  const client = {
    getSubscriber: async (userId: string) => resolver(userId),
  } as unknown as RevenueCatClient;
  const service = new SubscriptionReconciliationService(repo, client);
  return { service, repo, fake, setSubscriber: (fn) => (resolver = fn) };
}

/** An arbitrary RevenueCat subscriber snapshot for a user. */
function snapshotArb(userId: string): fc.Arbitrary<RevenueCatSubscriber> {
  return fc
    .record({
      cleaner: fc.boolean(),
      host: fc.boolean(),
    })
    .map(({ cleaner, host }) => {
      const entitlements = [];
      const future = new Date(Date.now() + 86_400_000);
      if (cleaner) {
        entitlements.push({ key: EntitlementKey.CLEANER_PRO, active: true, expiresAt: future, store: Store.APP_STORE });
      }
      if (host) {
        entitlements.push({ key: EntitlementKey.HOST_PRO, active: true, expiresAt: future, store: Store.PLAY_STORE });
      }
      return { userId, entitlements };
    });
}

describe('reconciliation — properties', () => {
  it('P6: convergence makes the mirror match the RevenueCat snapshot; re-running is a no-op', async () => {
    await fc.assert(
      fc.asyncProperty(snapshotArb('user-1'), async (snapshot) => {
        const { service, repo, setSubscriber } = build();
        // Seed a mirror row so it is a reconciliation candidate.
        await repo.applyDeltas(
          [
            {
              userId: 'user-1',
              entitlementKey: EntitlementKey.CLEANER_PRO,
              active: false,
              expiresAt: null,
              store: null,
              eventTimestampMs: 1,
            },
          ],
          null,
        );
        setSubscriber(() => snapshot);

        await service.reconcileUser('user-1');
        const first = await repo.findByUserId('user-1');
        await service.reconcileUser('user-1');
        const second = await repo.findByUserId('user-1');

        const cleaner = snapshot.entitlements.some((e) => e.key === EntitlementKey.CLEANER_PRO);
        const host = snapshot.entitlements.some((e) => e.key === EntitlementKey.HOST_PRO);
        expect(first?.cleanerProActive).toBe(cleaner);
        expect(first?.hostProActive).toBe(host);
        // Idempotent: second run yields the same entitlement state.
        expect(second?.cleanerProActive).toBe(cleaner);
        expect(second?.hostProActive).toBe(host);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P8: when RevenueCat is unreachable, an existing mirror row is never mutated', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (seedActive) => {
        const { service, repo, setSubscriber } = build();
        await repo.applyDeltas(
          [
            {
              userId: 'user-1',
              entitlementKey: EntitlementKey.CLEANER_PRO,
              active: seedActive,
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              store: Store.APP_STORE,
              eventTimestampMs: 1,
            },
          ],
          null,
        );
        const before = await repo.findByUserId('user-1');
        setSubscriber(() => null); // unreachable

        await service.reconcileUser('user-1');

        const after = await repo.findByUserId('user-1');
        expect(after?.cleanerProActive).toBe(before?.cleanerProActive);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P18: reconciliation creates a mirror row for a discovered subscriber that had none', async () => {
    await fc.assert(
      fc.asyncProperty(snapshotArb('new-user'), async (snapshot) => {
        const { service, repo, setSubscriber } = build();
        expect(await repo.findByUserId('new-user')).toBeNull();
        setSubscriber(() => snapshot);

        await service.reconcileUser('new-user');

        const created = await repo.findByUserId('new-user');
        expect(created).not.toBeNull();
        const cleaner = snapshot.entitlements.some((e) => e.key === EntitlementKey.CLEANER_PRO);
        expect(created?.cleanerProActive).toBe(cleaner);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

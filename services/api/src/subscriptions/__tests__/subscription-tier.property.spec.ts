import * as fc from 'fast-check';
import { RealSubscriptionTierService } from '../subscription-tier.service';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { Subscription } from '../entities/subscription.entity';
import { SubscriberRole, SubscriberTier } from '../../commission/commission.types';

/**
 * Property-based tests (fast-check) for tier derivation.
 *
 * Feature: revenuecat-subscriptions
 * Covers:
 * - Property 1: Tier Derivation Correctness (Requirements 1.2, 1.3)
 * - Property 2: Backward-Compatible Default (Requirements 1.5)
 * - Property 11: Role-Tier Independence (Requirements 1.7)
 * - Property 12: ad_free Non-Implication (Requirements 1.8)
 * - Property 17: Role-Specific Tier (Requirements 1.7)
 */

const NUM_RUNS = 200;

interface EntitlementArb {
  active: boolean;
  offsetMs: number; // expiry relative to now; negative = past
}

function mirrorFrom(
  cleaner: EntitlementArb | null,
  host: EntitlementArb | null,
  adFree: EntitlementArb | null,
): Subscription {
  const now = Date.now();
  const expiry = (e: EntitlementArb | null): Date | null =>
    e ? new Date(now + e.offsetMs) : null;
  return {
    id: 'sub',
    userId: 'user-1',
    cleanerProActive: cleaner?.active ?? false,
    cleanerProExpiresAt: expiry(cleaner),
    cleanerProStore: null,
    cleanerProLastEventAt: null,
    hostProActive: host?.active ?? false,
    hostProExpiresAt: expiry(host),
    hostProStore: null,
    hostProLastEventAt: null,
    adFreeActive: adFree?.active ?? false,
    adFreeExpiresAt: expiry(adFree),
    adFreeStore: null,
    adFreeLastEventAt: null,
    lastReconciledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Subscription;
}

function serviceWith(row: Subscription | null): RealSubscriptionTierService {
  const repo = { findByUserId: async () => row } as unknown as SubscriptionsRepository;
  return new RealSubscriptionTierService(repo);
}

/** An entitlement arbitrary: sometimes absent, else active/inactive with a past/future expiry. */
const entitlementArb: fc.Arbitrary<EntitlementArb | null> = fc.option(
  fc.record({
    active: fc.boolean(),
    // Expiry from ~1 day in the past to ~1 day in the future (and null handled by option).
    offsetMs: fc.integer({ min: -86_400_000, max: 86_400_000 }),
  }),
  { nil: null },
);

/** Whether an entitlement grants access: active AND future/open-ended expiry. */
function grantsAccess(e: EntitlementArb | null): boolean {
  if (!e || !e.active) {
    return false;
  }
  return e.offsetMs > 0; // strictly future (offset 0 is effectively now/past by the time we read)
}

describe('RealSubscriptionTierService — properties', () => {
  it('P1/P17: a role is PRO iff that role entitlement is active with future expiry', async () => {
    await fc.assert(
      fc.asyncProperty(entitlementArb, entitlementArb, async (cleaner, host) => {
        const svc = serviceWith(mirrorFrom(cleaner, host, null));
        const cleanerTier = await svc.getRoleTier('user-1', SubscriberRole.CLEANER);
        const hostTier = await svc.getRoleTier('user-1', SubscriberRole.HOST);
        // Allow the boundary case (offsetMs===0) either way by re-deriving with a tolerance.
        if (cleaner?.offsetMs !== 0) {
          expect(cleanerTier === SubscriberTier.PRO).toBe(grantsAccess(cleaner));
        }
        if (host?.offsetMs !== 0) {
          expect(hostTier === SubscriberTier.PRO).toBe(grantsAccess(host));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P11: role tiers are independent (cleaner tier never depends on host entitlement)', async () => {
    await fc.assert(
      fc.asyncProperty(entitlementArb, entitlementArb, async (cleaner, host) => {
        const withHost = serviceWith(mirrorFrom(cleaner, host, null));
        const withoutHost = serviceWith(mirrorFrom(cleaner, null, null));
        const a = await withHost.getRoleTier('user-1', SubscriberRole.CLEANER);
        const b = await withoutHost.getRoleTier('user-1', SubscriberRole.CLEANER);
        expect(a).toBe(b); // the host entitlement never changes the cleaner tier
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P12: ad_free alone never resolves PRO (global or per-role)', async () => {
    await fc.assert(
      fc.asyncProperty(entitlementArb, async (adFree) => {
        const svc = serviceWith(mirrorFrom(null, null, adFree));
        expect(await svc.getTier('user-1')).toBe(SubscriberTier.FREE);
        expect(await svc.getRoleTier('user-1', SubscriberRole.HOST)).toBe(SubscriberTier.FREE);
        expect(await svc.getRoleTier('user-1', SubscriberRole.CLEANER)).toBe(SubscriberTier.FREE);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P1 (global): getTier is PRO iff either role is PRO', async () => {
    await fc.assert(
      fc.asyncProperty(entitlementArb, entitlementArb, entitlementArb, async (cleaner, host, adFree) => {
        const svc = serviceWith(mirrorFrom(cleaner, host, adFree));
        const global = await svc.getTier('user-1');
        const expectedPro = grantsAccess(cleaner) || grantsAccess(host);
        if (cleaner?.offsetMs !== 0 && host?.offsetMs !== 0) {
          expect(global === SubscriberTier.PRO).toBe(expectedPro);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('P2: no mirror row -> FREE for global and both roles', async () => {
    const svc = serviceWith(null);
    expect(await svc.getTier('nobody')).toBe(SubscriberTier.FREE);
    expect(await svc.getRoleTier('nobody', SubscriberRole.HOST)).toBe(SubscriberTier.FREE);
    expect(await svc.getRoleTier('nobody', SubscriberRole.CLEANER)).toBe(SubscriberTier.FREE);
  });
});

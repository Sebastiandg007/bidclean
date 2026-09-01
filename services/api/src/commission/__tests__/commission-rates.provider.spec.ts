import { CommissionRatesProvider } from '../commission-rates.provider';
import { CommissionRateResolver } from '../rate-resolver.service';
import { SubscriptionTierContract } from '../contracts/subscription-tier.interface';
import { RateSide, ResolvedRate, SubscriberRole, SubscriberTier } from '../commission.types';
import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../commission.constants';

/**
 * Unit tests for the COMMISSION_RATES provider, exercised against fake SUBSCRIPTION_TIER contracts.
 *
 * Feature: commission-system
 * Validates: Requirements 2.1 (tier via contract), 2.5/2.6 (safe degradation, never blocks),
 * 4.4 (env-default fallback), 7.5 (preview shares resolution, no persistence),
 * and the role-aware extension (Host fee ← Host tier, Cleaner commission ← Cleaner tier).
 */

/** A fake tier contract that returns a fixed tier for both getTier and getRoleTier. */
function fixedTier(tier: SubscriberTier): SubscriptionTierContract {
  return { getTier: async () => tier, getRoleTier: async () => tier };
}

/** A fake tier contract that returns per-role tiers (the P0 mixed-role case). */
function perRoleTier(
  byRole: Record<SubscriberRole, SubscriberTier>,
): SubscriptionTierContract {
  return {
    getTier: async () =>
      byRole.HOST === SubscriberTier.PRO || byRole.CLEANER === SubscriberTier.PRO
        ? SubscriberTier.PRO
        : SubscriberTier.FREE,
    getRoleTier: async (_userId, role) => byRole[role],
  };
}

describe('CommissionRatesProvider', () => {
  function build(
    resolveSide: (side: RateSide, country: string, tier: SubscriberTier) => ResolvedRate,
    tierImpl: SubscriptionTierContract,
  ): CommissionRatesProvider {
    const resolver = {
      resolveSide: (side: RateSide, country: string, tier: SubscriberTier) =>
        resolveSide(side, country, tier),
    } as unknown as CommissionRateResolver;
    return new CommissionRatesProvider(resolver, tierImpl);
  }

  const freeTier: SubscriptionTierContract = fixedTier(SubscriberTier.FREE);

  it('resolves the Host side against the Host role tier', async () => {
    const seen: Array<{ side: RateSide; tier: SubscriberTier }> = [];
    const provider = build(
      (side, _c, tier) => {
        seen.push({ side, tier });
        return { rateBps: 1000, ruleId: 'h1' };
      },
      fixedTier(SubscriberTier.PRO),
    );
    const res = await provider.resolveHostRate({ country: 'CO', hostId: 'h', serviceType: 'standard' });
    expect(res).toEqual({ rateBps: 1000, ruleId: 'h1' });
    expect(seen[0]).toEqual({ side: RateSide.HOST, tier: SubscriberTier.PRO });
  });

  it('resolves the Cleaner side against the Cleaner role tier', async () => {
    const provider = build(
      (_side, _c, tier) => ({ rateBps: tier === SubscriberTier.PRO ? 100 : 300, ruleId: 'c1' }),
      fixedTier(SubscriberTier.PRO),
    );
    const res = await provider.resolveCleanerRate({ country: 'CO', cleanerId: 'c', serviceType: 'standard' });
    expect(res).toEqual({ rateBps: 100, ruleId: 'c1' });
  });

  it('scopes each side to its own role (Host PRO, Cleaner FREE — the P0 case)', async () => {
    // The same user is PRO as a Host and FREE as a Cleaner: each side must see its own tier.
    const tierImpl = perRoleTier({ HOST: SubscriberTier.PRO, CLEANER: SubscriberTier.FREE });
    const provider = build(
      (_side, _c, tier) => ({ rateBps: tier === SubscriberTier.PRO ? 100 : 300, ruleId: null }),
      tierImpl,
    );
    const host = await provider.resolveHostRate({ country: 'CO', hostId: 'u', serviceType: 'standard' });
    const cleaner = await provider.resolveCleanerRate({ country: 'CO', cleanerId: 'u', serviceType: 'standard' });
    expect(host.rateBps).toBe(100); // Host PRO
    expect(cleaner.rateBps).toBe(300); // Cleaner FREE
  });

  it('degrades to FREE when the role-tier lookup throws (never blocks)', async () => {
    const provider = build(
      (_s, _c, tier) => ({ rateBps: tier === SubscriberTier.FREE ? 300 : 100, ruleId: null }),
      {
        getTier: async () => { throw new Error('tier service down'); },
        getRoleTier: async () => { throw new Error('tier service down'); },
      },
    );
    const res = await provider.resolveCleanerRate({ country: 'CO', cleanerId: 'c', serviceType: 'standard' });
    expect(res.rateBps).toBe(300); // FREE path used
  });

  it('returns the env default when the resolver itself throws', async () => {
    const provider = build(
      () => { throw new Error('resolver boom'); },
      freeTier,
    );
    const host = await provider.resolveHostRate({ country: 'US', hostId: 'h', serviceType: 'standard' });
    const cleaner = await provider.resolveCleanerRate({ country: 'US', cleanerId: 'c', serviceType: 'standard' });
    expect(host).toEqual({ rateBps: OFFER_HOST_FEE_RATE_BPS, ruleId: null });
    expect(cleaner).toEqual({ rateBps: OFFER_CLEANER_RATE_BPS, ruleId: null });
  });

  it('preview shares the same resolution as resolve', async () => {
    const provider = build(() => ({ rateBps: 250, ruleId: 'p1' }), freeTier);
    const resolved = await provider.resolveHostRate({ country: 'CO', hostId: 'h', serviceType: 's' });
    const preview = await provider.previewHostRate({ country: 'CO', hostId: 'h', serviceType: 's' });
    expect(preview).toEqual(resolved);
  });
});

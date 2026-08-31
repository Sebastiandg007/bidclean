import { CommissionRatesProvider } from '../commission-rates.provider';
import { DefaultSubscriptionTierService } from '../contracts/default-subscription-tier.service';
import { CommissionRateResolver } from '../rate-resolver.service';
import { SubscriptionTierContract } from '../contracts/subscription-tier.interface';
import { RateSide, ResolvedRate, SubscriberTier } from '../commission.types';
import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../commission.constants';

/**
 * Unit tests for the SUBSCRIPTION_TIER stub and the COMMISSION_RATES provider.
 *
 * Feature: commission-system
 * Validates: Requirements 2.1 (tier via contract), 2.5/2.6 (safe degradation, never blocks),
 * 4.4 (env-default fallback), 7.5 (preview shares resolution, no persistence).
 */

describe('DefaultSubscriptionTierService', () => {
  it('returns FREE for every user', async () => {
    const svc = new DefaultSubscriptionTierService();
    await expect(svc.getTier('anyone')).resolves.toBe(SubscriberTier.FREE);
  });
});

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

  const freeTier: SubscriptionTierContract = { getTier: async () => SubscriberTier.FREE };

  it('resolves the Host side against the Host tier', async () => {
    const seen: Array<{ side: RateSide; tier: SubscriberTier }> = [];
    const provider = build(
      (side, _c, tier) => {
        seen.push({ side, tier });
        return { rateBps: 1000, ruleId: 'h1' };
      },
      { getTier: async () => SubscriberTier.PRO },
    );
    const res = await provider.resolveHostRate({ country: 'CO', hostId: 'h', serviceType: 'standard' });
    expect(res).toEqual({ rateBps: 1000, ruleId: 'h1' });
    expect(seen[0]).toEqual({ side: RateSide.HOST, tier: SubscriberTier.PRO });
  });

  it('resolves the Cleaner side against the Cleaner tier', async () => {
    const provider = build(
      (_side, _c, tier) => ({ rateBps: tier === SubscriberTier.PRO ? 100 : 300, ruleId: 'c1' }),
      { getTier: async () => SubscriberTier.PRO },
    );
    const res = await provider.resolveCleanerRate({ country: 'CO', cleanerId: 'c', serviceType: 'standard' });
    expect(res).toEqual({ rateBps: 100, ruleId: 'c1' });
  });

  it('degrades to FREE when the tier lookup throws (never blocks)', async () => {
    const provider = build(
      (_s, _c, tier) => ({ rateBps: tier === SubscriberTier.FREE ? 300 : 100, ruleId: null }),
      { getTier: async () => { throw new Error('tier service down'); } },
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

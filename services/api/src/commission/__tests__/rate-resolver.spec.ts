import { CommissionRateResolver } from '../rate-resolver.service';
import { CommissionRulesCache } from '../commission-rules.cache';
import {
  CommissionRuleRow,
  RateSide,
  SubscriberTier,
} from '../commission.types';
import {
  specificityScore,
  compareBySpecificityThenPriorityThenDateThenId,
} from '../rule-specificity';
import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../commission.constants';

/**
 * Unit tests for the pure resolution core (specificity comparator + resolver).
 *
 * Feature: commission-system
 * Validates: Requirements 1.2 (deterministic ordering), 1.3 (env-default fallback),
 * 3.1 (most-specific / country beats ANY), NULL = wildcard matching.
 */

const NOW = new Date('2026-06-01T00:00:00.000Z');

function rule(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    country: overrides.country ?? null,
    subscriberTier: overrides.subscriberTier ?? null,
    serviceType: overrides.serviceType ?? null,
    appliesTo: overrides.appliesTo ?? RateSide.CLEANER,
    rateBps: overrides.rateBps ?? 300,
    priority: overrides.priority ?? 0,
    effectiveFrom: overrides.effectiveFrom ?? new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: overrides.effectiveTo ?? null,
    isActive: overrides.isActive ?? true,
  };
}

/** A fake cache returning a fixed ruleset (already window-filtered by the test as needed). */
function fakeCache(rules: CommissionRuleRow[]): CommissionRulesCache {
  return {
    activeRules: (_at: Date) => rules,
  } as unknown as CommissionRulesCache;
}

describe('specificityScore', () => {
  it('counts non-null scope dimensions', () => {
    expect(specificityScore({ country: null, subscriberTier: null, serviceType: null })).toBe(0);
    expect(specificityScore({ country: 'CO', subscriberTier: null, serviceType: null })).toBe(1);
    expect(specificityScore({ country: 'CO', subscriberTier: 'PRO', serviceType: null })).toBe(2);
    expect(specificityScore({ country: 'CO', subscriberTier: 'PRO', serviceType: 'airbnb' })).toBe(3);
  });
});

describe('compareBySpecificityThenPriorityThenDateThenId', () => {
  it('orders by specificity, then priority, then effective_from, then lowest UUID', () => {
    const low = rule({ id: 'b', country: null, priority: 0 });
    const high = rule({ id: 'a', country: 'CO', priority: 0 });
    expect([low, high].sort(compareBySpecificityThenPriorityThenDateThenId)[0]).toBe(high);

    const p1 = rule({ id: 'a', country: 'CO', priority: 1 });
    const p2 = rule({ id: 'b', country: 'CO', priority: 5 });
    expect([p1, p2].sort(compareBySpecificityThenPriorityThenDateThenId)[0]).toBe(p2);

    const older = rule({ id: 'a', country: 'CO', priority: 1, effectiveFrom: new Date('2026-01-01') });
    const newer = rule({ id: 'b', country: 'CO', priority: 1, effectiveFrom: new Date('2026-03-01') });
    expect([older, newer].sort(compareBySpecificityThenPriorityThenDateThenId)[0]).toBe(newer);

    const idA = rule({ id: 'aaaa', country: 'CO', priority: 1, effectiveFrom: new Date('2026-01-01') });
    const idB = rule({ id: 'bbbb', country: 'CO', priority: 1, effectiveFrom: new Date('2026-01-01') });
    expect([idB, idA].sort(compareBySpecificityThenPriorityThenDateThenId)[0]).toBe(idA);
  });
});

describe('CommissionRateResolver.resolveSide', () => {
  it('returns the env default with null ruleId when no rule matches (Req 1.3)', () => {
    const resolver = new CommissionRateResolver(fakeCache([]));
    const host = resolver.resolveSide(RateSide.HOST, 'US', SubscriberTier.FREE, 'standard', NOW);
    const cleaner = resolver.resolveSide(RateSide.CLEANER, 'US', SubscriberTier.FREE, 'standard', NOW);
    expect(host).toEqual({ rateBps: OFFER_HOST_FEE_RATE_BPS, ruleId: null });
    expect(cleaner).toEqual({ rateBps: OFFER_CLEANER_RATE_BPS, ruleId: null });
  });

  it('treats a NULL scope column as a wildcard', () => {
    const anyRule = rule({ id: 'any', appliesTo: RateSide.CLEANER, rateBps: 250 });
    const resolver = new CommissionRateResolver(fakeCache([anyRule]));
    const res = resolver.resolveSide(RateSide.CLEANER, 'DE', SubscriberTier.PRO, 'office', NOW);
    expect(res).toEqual({ rateBps: 250, ruleId: 'any' });
  });

  it('picks the country-specific rule over an ANY-country rule (Req 3.1)', () => {
    const anyRule = rule({ id: 'any', country: null, rateBps: 300 });
    const coRule = rule({ id: 'co', country: 'CO', rateBps: 200 });
    const resolver = new CommissionRateResolver(fakeCache([anyRule, coRule]));
    const res = resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW);
    expect(res).toEqual({ rateBps: 200, ruleId: 'co' });
  });

  it('only considers rules for the requested side', () => {
    const hostRule = rule({ id: 'h', appliesTo: RateSide.HOST, rateBps: 900 });
    const resolver = new CommissionRateResolver(fakeCache([hostRule]));
    const cleaner = resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW);
    expect(cleaner).toEqual({ rateBps: OFFER_CLEANER_RATE_BPS, ruleId: null });
  });

  it('prefers a PRO-scoped rule for a PRO actor over a FREE/ANY rule', () => {
    const anyRule = rule({ id: 'any', subscriberTier: null, rateBps: 300 });
    const proRule = rule({ id: 'pro', subscriberTier: SubscriberTier.PRO, rateBps: 100 });
    const resolver = new CommissionRateResolver(fakeCache([anyRule, proRule]));
    const pro = resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.PRO, 'standard', NOW);
    expect(pro).toEqual({ rateBps: 100, ruleId: 'pro' });
    const free = resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW);
    expect(free).toEqual({ rateBps: 300, ruleId: 'any' });
  });
});

import { CommissionRulesCache } from '../commission-rules.cache';
import { CommissionRuleRow, RateSide } from '../commission.types';

/**
 * Unit tests for CommissionRulesCache.
 *
 * Feature: commission-system
 * Validates: Requirements 1.4 + 5.7 (effective-window filtering incl. future-dated inert),
 * refresh-failure retains last good snapshot.
 */

function rule(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
  return {
    id: overrides.id ?? 'r1',
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

describe('CommissionRulesCache', () => {
  it('includes rules whose window contains the instant', async () => {
    const cache = new CommissionRulesCache();
    cache.setLoader(async () => [rule({ id: 'open' })]);
    await cache.refresh();
    expect(cache.activeRules(new Date('2026-06-01')).map((r) => r.id)).toEqual(['open']);
  });

  it('excludes future-dated rules until their effective_from (inert)', async () => {
    const cache = new CommissionRulesCache();
    cache.setLoader(async () => [
      rule({ id: 'future', effectiveFrom: new Date('2026-09-01') }),
    ]);
    await cache.refresh();
    expect(cache.activeRules(new Date('2026-06-01'))).toHaveLength(0);
    expect(cache.activeRules(new Date('2026-09-02')).map((r) => r.id)).toEqual(['future']);
  });

  it('excludes rules past their effective_to (half-open window)', async () => {
    const cache = new CommissionRulesCache();
    cache.setLoader(async () => [
      rule({ id: 'ended', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-05-01') }),
    ]);
    await cache.refresh();
    expect(cache.activeRules(new Date('2026-06-01'))).toHaveLength(0);
    // exclusive upper bound: exactly effective_to is NOT included
    expect(cache.activeRules(new Date('2026-05-01'))).toHaveLength(0);
    expect(cache.activeRules(new Date('2026-04-30'))).toHaveLength(1);
  });

  it('excludes inactive rules', async () => {
    const cache = new CommissionRulesCache();
    cache.setLoader(async () => [rule({ id: 'off', isActive: false })]);
    await cache.refresh();
    expect(cache.activeRules(new Date('2026-06-01'))).toHaveLength(0);
  });

  it('retains the last good snapshot when a refresh fails', async () => {
    const cache = new CommissionRulesCache();
    let fail = false;
    cache.setLoader(async () => {
      if (fail) {
        throw new Error('db down');
      }
      return [rule({ id: 'good' })];
    });
    expect(await cache.refresh()).toBe(true);
    expect(cache.activeRules(new Date('2026-06-01')).map((r) => r.id)).toEqual(['good']);

    fail = true;
    expect(await cache.refresh()).toBe(false);
    // snapshot preserved, not emptied
    expect(cache.activeRules(new Date('2026-06-01')).map((r) => r.id)).toEqual(['good']);
    expect(cache.isReady()).toBe(true);
  });

  it('returns false when refreshed before a loader is set', async () => {
    const cache = new CommissionRulesCache();
    expect(await cache.refresh()).toBe(false);
    expect(cache.isReady()).toBe(false);
  });
});

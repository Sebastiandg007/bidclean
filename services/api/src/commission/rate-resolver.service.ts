import { Injectable } from '@nestjs/common';
import { CommissionRulesCache } from './commission-rules.cache';
import { defaultRateBpsForSide } from './commission.constants';
import {
  CommissionRuleRow,
  RateSide,
  ResolvedRate,
  SubscriberTier,
} from './commission.types';
import { compareBySpecificityThenPriorityThenDateThenId } from './rule-specificity';

/**
 * CommissionRateResolver — pure per-side selection over the cached active ruleset.
 *
 * Resolves ONE side (HOST or CLEANER) for a given country + tier + serviceType at a
 * given instant. A NULL scope column on a rule is a wildcard. When no rule matches, the
 * side's environment default rate is returned with a null ruleId (backward compatible).
 * The resolver performs NO money arithmetic and NO I/O beyond reading the in-memory cache.
 */
@Injectable()
export class CommissionRateResolver {
  constructor(private readonly cache: CommissionRulesCache) {}

  /**
   * Resolve the effective rate for one side + context.
   *
   * @param side - HOST or CLEANER
   * @param country - ISO 3166-1 alpha-2 country
   * @param tier - the relevant actor's subscriber tier
   * @param serviceType - the offer service type
   * @param at - the resolution instant (creation time for HOST, match time for CLEANER)
   */
  resolveSide(
    side: RateSide,
    country: string,
    tier: SubscriberTier,
    serviceType: string,
    at: Date,
  ): ResolvedRate {
    const candidates = this.cache
      .activeRules(at)
      .filter((rule) => rule.appliesTo === side)
      .filter((rule) => this.matches(rule, country, tier, serviceType));

    const winner = [...candidates].sort(
      compareBySpecificityThenPriorityThenDateThenId,
    )[0];
    if (winner === undefined) {
      return { rateBps: defaultRateBpsForSide(side), ruleId: null };
    }
    return { rateBps: winner.rateBps, ruleId: winner.id };
  }

  /** A rule matches when each scope dimension is either ANY (null) or equal to the context. */
  private matches(
    rule: CommissionRuleRow,
    country: string,
    tier: SubscriberTier,
    serviceType: string,
  ): boolean {
    return (
      (rule.country === null || rule.country === country) &&
      (rule.subscriberTier === null || rule.subscriberTier === tier) &&
      (rule.serviceType === null || rule.serviceType === serviceType)
    );
  }
}

import { SubscriberTier } from '../commission.types';

/**
 * Subscription tier contract.
 *
 * Exposed so the commission resolver can obtain a user's FREE/PRO tier WITHOUT reading
 * any subscription store directly. The real implementation (revenuecat-subscriptions,
 * Spec 11) also owns the last-known-tier cache used for safe degradation. commission-system
 * ships only the FREE-returning default stub and stores no subscription state.
 */
export interface SubscriptionTierContract {
  /**
   * Resolve a user's subscriber tier.
   * @param userId - The user UUID
   * @returns FREE or PRO
   */
  getTier(userId: string): Promise<SubscriberTier>;
}

/** DI token for SubscriptionTierContract */
export const SUBSCRIPTION_TIER = Symbol('SUBSCRIPTION_TIER');

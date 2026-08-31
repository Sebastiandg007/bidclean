import { SubscriberRole, SubscriberTier } from '../commission.types';

/**
 * Subscription tier contract.
 *
 * Exposed so the commission resolver can obtain a user's FREE/PRO tier WITHOUT reading
 * any subscription store directly. The real implementation (revenuecat-subscriptions,
 * Spec 11) also owns the last-known-tier cache used for safe degradation. commission-system
 * ships only the FREE-returning default stub and stores no subscription state.
 *
 * Tier is resolved per role: a user can be PRO as a Host (active `host_pro`) and FREE as a
 * Cleaner (no `cleaner_pro`), so the Host fee and the Cleaner commission must each resolve
 * against their own role. `getTier` keeps the global answer for non-role-scoped consumers.
 */
export interface SubscriptionTierContract {
  /**
   * Resolve a user's GLOBAL subscriber tier (PRO iff PRO in any role).
   * @param userId - The user UUID
   * @returns FREE or PRO
   */
  getTier(userId: string): Promise<SubscriberTier>;

  /**
   * Resolve a user's subscriber tier FOR A SPECIFIC ROLE.
   *
   * The Host tier derives from the `host_pro` entitlement only and the Cleaner tier from
   * `cleaner_pro` only, so a user PRO in one role and FREE in the other resolves correctly
   * per role. The `ad_free` entitlement never contributes to any tier.
   *
   * @param userId - The user UUID
   * @param role - The role whose tier is requested (HOST or CLEANER)
   * @returns FREE or PRO for that role
   */
  getRoleTier(userId: string, role: SubscriberRole): Promise<SubscriberTier>;
}

/** DI token for SubscriptionTierContract */
export const SUBSCRIPTION_TIER = Symbol('SUBSCRIPTION_TIER');

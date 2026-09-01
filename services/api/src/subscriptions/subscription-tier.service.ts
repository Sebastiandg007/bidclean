import { Injectable } from '@nestjs/common';
import {
  SubscriberRole,
  SubscriberTier,
} from '../commission/commission.types';
import { SubscriptionTierContract } from '../commission/contracts/subscription-tier.interface';
import { SubscriptionsRepository } from './subscriptions.repository';
import { Subscription } from './entities/subscription.entity';

/**
 * The real SUBSCRIPTION_TIER implementation — replaces commission-system's FREE-returning stub.
 *
 * Tier is DERIVED at query time from the durable mirror; there is no stored flag. A role is PRO
 * iff that role's entitlement is active AND its expiry is in the future (or open-ended). The
 * `ad_free` entitlement never contributes to any tier. With no mirror row the answer is FREE
 * (backward-compatible default). Reads are a single indexed lookup — no synchronous RevenueCat
 * call on the hot path, so a RevenueCat outage never changes a resolved tier.
 */
@Injectable()
export class RealSubscriptionTierService implements SubscriptionTierContract {
  constructor(private readonly repo: SubscriptionsRepository) {}

  /** Resolve the tier for a single role (Host <- host_pro, Cleaner <- cleaner_pro). */
  async getRoleTier(userId: string, role: SubscriberRole): Promise<SubscriberTier> {
    const row = await this.repo.findByUserId(userId);
    if (!row) {
      return SubscriberTier.FREE;
    }
    return this.isRolePro(row, role) ? SubscriberTier.PRO : SubscriberTier.FREE;
  }

  /** Resolve the GLOBAL tier: PRO iff PRO in either role. */
  async getTier(userId: string): Promise<SubscriberTier> {
    const row = await this.repo.findByUserId(userId);
    if (!row) {
      return SubscriberTier.FREE;
    }
    const isPro =
      this.isRolePro(row, SubscriberRole.HOST) || this.isRolePro(row, SubscriberRole.CLEANER);
    return isPro ? SubscriberTier.PRO : SubscriberTier.FREE;
  }

  /** Whether the role's entitlement is active with a future/open-ended expiry. */
  private isRolePro(row: Subscription, role: SubscriberRole): boolean {
    if (role === SubscriberRole.HOST) {
      return isEntitlementActive(row.hostProActive, row.hostProExpiresAt);
    }
    return isEntitlementActive(row.cleanerProActive, row.cleanerProExpiresAt);
  }
}

/** An entitlement grants access when it is active and its expiry is null or in the future. */
function isEntitlementActive(active: boolean, expiresAt: Date | null): boolean {
  if (!active) {
    return false;
  }
  return expiresAt === null || expiresAt.getTime() > Date.now();
}

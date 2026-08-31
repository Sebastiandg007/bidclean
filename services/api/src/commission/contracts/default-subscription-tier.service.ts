import { Injectable } from '@nestjs/common';
import { SubscriptionTierContract } from './subscription-tier.interface';
import { SubscriberRole, SubscriberTier } from '../commission.types';

/**
 * Default SubscriptionTierContract implementation.
 *
 * Returns FREE for every user, in every role. It is replaced by the real RevenueCat-backed
 * implementation in revenuecat-subscriptions (Spec 11), which will also own the
 * last-known-tier cache used for safe degradation. Until then, PRO-scoped commission rules
 * never activate and behavior matches the current flat model.
 */
@Injectable()
export class DefaultSubscriptionTierService implements SubscriptionTierContract {
  async getTier(_userId: string): Promise<SubscriberTier> {
    return SubscriberTier.FREE;
  }

  async getRoleTier(_userId: string, _role: SubscriberRole): Promise<SubscriberTier> {
    return SubscriberTier.FREE;
  }
}

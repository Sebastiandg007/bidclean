import { Injectable } from '@nestjs/common';
import { SubscriptionTierContract } from './subscription-tier.interface';
import { SubscriberTier } from '../commission.types';

/**
 * Default SubscriptionTierContract implementation.
 *
 * Returns FREE for every user. It is replaced by the real RevenueCat-backed implementation
 * in revenuecat-subscriptions (Spec 11), which will also own the last-known-tier cache used
 * for safe degradation. Until then, PRO-scoped commission rules never activate and behavior
 * matches the current flat model.
 */
@Injectable()
export class DefaultSubscriptionTierService implements SubscriptionTierContract {
  async getTier(_userId: string): Promise<SubscriberTier> {
    return SubscriberTier.FREE;
  }
}

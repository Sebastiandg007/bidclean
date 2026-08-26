/**
 * BullMQ job payload types for all offer queues.
 *
 * Every payload includes `offerId` + `expectedState` for the stale-job guard pattern.
 * Before processing, processors validate that the current offer state matches
 * the expected state — stale jobs are skipped silently (idempotent).
 */

import { DeliveryTier } from '../offers.types';

// Re-export the existing RadiusExpansionJobPayload for centralized access
export type { RadiusExpansionJobPayload } from '../expansion/radius-expansion.types';

/**
 * Job payload for the offer-tier-delivery queue.
 *
 * Triggers delivery of an offer to a specific tier of Cleaners.
 * Used by the DeliverySchedulerService when scheduling delayed tier delivery.
 */
export interface TierDeliveryJobData {
  /** Offer being delivered */
  readonly offerId: string;
  /** Target delivery tier */
  readonly tier: DeliveryTier;
  /** Expected offer state at processing time (stale-job guard) */
  readonly expectedState: string;
  /** Expected expansion step at processing time (stale-job guard) */
  readonly expectedStep: number;
  /** Current radius expansion step when job was created */
  readonly radiusStep: number;
}

/**
 * Job payload for the offer-favorites-window queue.
 *
 * Triggers when the favorites-first delivery window expires.
 * If the offer is still in a deliverable state, PRO tier delivery begins.
 */
export interface FavoritesWindowJobData {
  /** Offer whose favorites window is expiring */
  readonly offerId: string;
  /** Expected offer state at processing time (stale-job guard) */
  readonly expectedState: string;
}

/**
 * Job payload for the offer-push-notification queue.
 *
 * Triggers a push notification to a single Cleaner via OneSignal.
 * Dispatched when WebSocket delivery fails and push fallback is needed.
 */
export interface PushNotificationJobData {
  /** Offer being notified about */
  readonly offerId: string;
  /** Target Cleaner's UUID */
  readonly cleanerId: string;
  /** Delivery tier of the Cleaner (for tracking) */
  readonly tier: DeliveryTier;
  /** Serialized offer summary payload for the push notification */
  readonly offerPayload: Record<string, unknown>;
}

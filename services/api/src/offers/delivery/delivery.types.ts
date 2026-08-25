import { DeliveryTier, DeliveryStatus, DeliveryChannel } from '../offers.types';

/**
 * Delivery-specific types.
 *
 * Used by the DeliverySchedulerService and CentrifugoClient.
 */

/** A Cleaner targeted for delivery */
export interface DeliveryTarget {
  readonly cleanerId: string;
  readonly tier: DeliveryTier;
  readonly channelName: string;
}

/** Result of a single delivery attempt */
export interface DeliveryAttemptResult {
  readonly cleanerId: string;
  readonly status: DeliveryStatus;
  readonly channel: DeliveryChannel | null;
  readonly failureReason: string | null;
}

/** Delivery batch configuration */
export interface DeliveryBatchConfig {
  readonly offerId: string;
  readonly targets: DeliveryTarget[];
  readonly radiusStep: number;
}

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

// ────────────────────────────────────────────────────────────────────────────────
// Centrifugo HTTP API types
// ────────────────────────────────────────────────────────────────────────────────

/** Request body for Centrifugo publish endpoint */
export interface CentrifugoPublishRequest {
  readonly channel: string;
  readonly data: unknown;
}

/** Request body for Centrifugo broadcast endpoint */
export interface CentrifugoBroadcastRequest {
  readonly channels: string[];
  readonly data: unknown;
}

/** Centrifugo API success response */
export interface CentrifugoApiResponse {
  readonly result: Record<string, unknown>;
}

/** Centrifugo API error response */
export interface CentrifugoApiError {
  readonly error: {
    readonly code: number;
    readonly message: string;
  };
}

/** Configuration required by CentrifugoClient */
export interface CentrifugoClientConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly maxRetries: number;
  readonly backoffDelayMs: number;
}

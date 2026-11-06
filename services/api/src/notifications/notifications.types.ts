/**
 * Backend notification type definitions.
 *
 * These string-union constants mirror `@bidclean/shared`'s `notification.types.ts` (the canonical
 * cross-platform contract consumed by the mobile app). They are re-declared here because the api
 * service compiles with `rootDir: ./src` and consumes `@bidclean/shared` as a workspace source
 * package, which cannot be pulled into the api program without a prebuilt declaration step in CI.
 * This mirrors the existing repo convention where each service owns its domain types locally
 * (see `subscriptions.types.ts`, `payments.types.ts`). The VALUES are identical to the shared
 * contract and MUST stay in parity; a divergence would break the API boundary.
 */

/** The concrete notification types, one per notification-worthy domain fact. */
export const NotificationType = {
  OFFER_MATCHED: 'offer.matched',
  OFFER_CANCELLED: 'offer.cancelled',
  OFFER_EXPIRED: 'offer.expired',
  OFFER_COMPLETED: 'offer.completed',
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_RELEASED: 'payment.released',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_DISPUTED: 'payment.disputed',
  NEGOTIATION_PROPOSAL_CREATED: 'negotiation_proposal_created',
  NEGOTIATION_PROPOSAL_COUNTERED: 'negotiation_proposal_countered',
  NEGOTIATION_PROPOSAL_REJECTED: 'negotiation_proposal_rejected',
  NEGOTIATION_PROPOSAL_ACCEPTED: 'negotiation_proposal_accepted',
  MESSAGE_CREATED: 'message-created',
  CALL_INVITED: 'call-invited',
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Logical categories used for per-category opt-in/out and OneSignal segmentation. */
export const NotificationCategory = {
  OFFERS: 'offers',
  PAYMENTS: 'payments',
  NEGOTIATION: 'negotiation',
  MESSAGES: 'messages',
  CALLS: 'calls',
} as const;

export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

/** Delivery priority; drives quiet-hours exemption together with `quietHoursBehavior`. */
export const NotificationPriority = {
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
  LOW: 'LOW',
} as const;

export type NotificationPriority =
  (typeof NotificationPriority)[keyof typeof NotificationPriority];

/** The delivery medium. Only PUSH is implemented; modeled so EMAIL/SMS are additive later. */
export const NotificationChannel = {
  PUSH: 'PUSH',
} as const;

export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Ledger row lifecycle status. */
export const NotificationStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_FINAL: 'FAILED_FINAL',
  SUPPRESSED: 'SUPPRESSED',
} as const;

export type NotificationStatus =
  (typeof NotificationStatus)[keyof typeof NotificationStatus];

/** Per-device platform. */
export const Platform = {
  IOS: 'IOS',
  ANDROID: 'ANDROID',
  WEB: 'WEB',
} as const;

export type Platform = (typeof Platform)[keyof typeof Platform];

/** Why an intent was suppressed (audit only, never a delivery failure). */
export const SuppressionReason = {
  NO_DEVICE: 'no-device',
  OPTED_OUT: 'opted-out',
  QUIET_HOURS: 'quiet-hours',
  FOREGROUND: 'foreground',
} as const;

export type SuppressionReason =
  (typeof SuppressionReason)[keyof typeof SuppressionReason];

/** A typed, id-based deep-link carried in the push `data` payload. */
export interface DeepLink {
  readonly type: string;
  readonly [id: string]: string;
}

/**
 * The internal record of "notify user X about event Y", built by a per-domain mapper from an
 * outbox row and persisted as a ledger row (deduped by `dedupKey`) before any transport call.
 */
export interface NotificationIntent {
  readonly recipientUserId: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly dedupKey: string;
  readonly deepLink: DeepLink;
  readonly priority: NotificationPriority;
  readonly payloadRef: Readonly<Record<string, string>>;
}

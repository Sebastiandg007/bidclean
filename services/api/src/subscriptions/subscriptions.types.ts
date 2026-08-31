/**
 * revenuecat-subscriptions domain types.
 *
 * This module is the source of truth for a user's subscription TIER (FREE vs PRO). It mirrors
 * RevenueCat entitlement state into a durable local read model and derives tier at query time.
 *
 * Two identifier spaces are kept deliberately separate:
 * - {@link EntitlementKey} — the INTERNAL logical key used throughout the code (`CLEANER_PRO`).
 * - The external RevenueCat entitlement id (its `lookup_key`, e.g. `cleaner_pro`) — configured
 *   via {@link ../subscriptions.constants.ENTITLEMENT_ID_MAP} and never hardcoded in logic.
 */

/** Internal logical entitlement keys the platform recognises. */
export const EntitlementKey = {
  CLEANER_PRO: 'CLEANER_PRO',
  HOST_PRO: 'HOST_PRO',
  AD_FREE: 'AD_FREE',
} as const;
export type EntitlementKey = (typeof EntitlementKey)[keyof typeof EntitlementKey];

/**
 * The role a subscriber tier is resolved against.
 *
 * Re-declared here (rather than imported from commission) so the subscriptions module owns its
 * own vocabulary; it maps 1:1 to commission's `SubscriberRole`. Host tier derives from
 * `host_pro`, Cleaner tier from `cleaner_pro`; the two are independent.
 */
export const SubscriberRole = { HOST: 'HOST', CLEANER: 'CLEANER' } as const;
export type SubscriberRole = (typeof SubscriberRole)[keyof typeof SubscriberRole];

/** The purchase source of an entitlement, as reported by RevenueCat. */
export const Store = {
  APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
  AMAZON: 'amazon',
  STRIPE: 'stripe',
  PROMOTIONAL: 'promotional',
} as const;
export type Store = (typeof Store)[keyof typeof Store];

/** RevenueCat server-to-server event types this module handles explicitly. */
export const RevenueCatEventType = {
  INITIAL_PURCHASE: 'INITIAL_PURCHASE',
  RENEWAL: 'RENEWAL',
  PRODUCT_CHANGE: 'PRODUCT_CHANGE',
  CANCELLATION: 'CANCELLATION',
  UNCANCELLATION: 'UNCANCELLATION',
  EXPIRATION: 'EXPIRATION',
  BILLING_ISSUE: 'BILLING_ISSUE',
  SUBSCRIPTION_PAUSED: 'SUBSCRIPTION_PAUSED',
  TRANSFER: 'TRANSFER',
} as const;
export type RevenueCatEventType =
  (typeof RevenueCatEventType)[keyof typeof RevenueCatEventType];

/** Dispatch lifecycle of a ledger row (the webhook outbox state). */
export const DispatchStatus = {
  RECEIVED: 'RECEIVED',
  QUEUED: 'QUEUED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
} as const;
export type DispatchStatus = (typeof DispatchStatus)[keyof typeof DispatchStatus];

/** The global subscriber tier value (mirrors commission's SubscriberTier). */
export const SubscriberTier = { FREE: 'FREE', PRO: 'PRO' } as const;
export type SubscriberTier = (typeof SubscriberTier)[keyof typeof SubscriberTier];

/** One entitlement's current state, as exposed to clients. */
export interface EntitlementState {
  readonly key: EntitlementKey;
  readonly active: boolean;
  readonly expiresAt: string | null;
  readonly store: Store | null;
}

/** The client-facing view returned by GET /subscriptions/me. */
export interface SubscriptionView {
  /** Global tier: PRO iff the user is PRO in any role. */
  readonly tier: SubscriberTier;
  /** Per-role tiers, resolved independently. */
  readonly roleTiers: { readonly HOST: SubscriberTier; readonly CLEANER: SubscriberTier };
  readonly entitlements: readonly EntitlementState[];
}

/**
 * The normalized effect of a single RevenueCat event on ONE entitlement of ONE user.
 *
 * A stale delta (older `eventTimestampMs` than the entitlement's `last_event_at`) is ignored.
 * `transferToUserId` is set only on a TRANSFER, identifying the destination subscriber.
 */
export interface EntitlementDelta {
  /** The subscriber the delta applies to (RevenueCat app_user_id = internal user UUID). */
  readonly userId: string;
  /** On TRANSFER only: the destination subscriber that gains the entitlement. */
  readonly transferToUserId?: string;
  readonly entitlementKey: EntitlementKey;
  readonly active: boolean;
  readonly expiresAt: string | null;
  readonly store: Store | null;
  /** RevenueCat event time in epoch ms; compared against the entitlement's last_event_at. */
  readonly eventTimestampMs: number;
}

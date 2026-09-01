/**
 * Subscriptions types (mobile) — mirror the backend `/subscriptions/me` contract.
 *
 * The backend mirror is authoritative for anything affecting money/access; these types
 * describe the server-authoritative view the client renders. Client-side `customerInfo` from
 * the RevenueCat SDK is a UI convenience only and never grants access.
 */

/** Internal logical entitlement keys, matching the backend. */
export const EntitlementKey = {
  CLEANER_PRO: 'CLEANER_PRO',
  HOST_PRO: 'HOST_PRO',
  AD_FREE: 'AD_FREE',
} as const;
export type EntitlementKey = (typeof EntitlementKey)[keyof typeof EntitlementKey];

/** The subscriber tier value (global or per-role). */
export const SubscriberTier = { FREE: 'FREE', PRO: 'PRO' } as const;
export type SubscriberTier = (typeof SubscriberTier)[keyof typeof SubscriberTier];

/** The role a paywall/badge is scoped to. */
export const SubscriberRole = { HOST: 'HOST', CLEANER: 'CLEANER' } as const;
export type SubscriberRole = (typeof SubscriberRole)[keyof typeof SubscriberRole];

/** One entitlement's active state, as returned by the backend. */
export interface EntitlementState {
  readonly key: EntitlementKey;
  readonly active: boolean;
  readonly expiresAt: string | null;
  readonly store: string | null;
}

/** The server-authoritative view returned by GET /subscriptions/me. */
export interface SubscriptionView {
  readonly tier: SubscriberTier;
  readonly roleTiers: { readonly HOST: SubscriberTier; readonly CLEANER: SubscriberTier };
  readonly entitlements: readonly EntitlementState[];
}

/** The outcome of a purchase or restore action, surfaced to the UI with an i18n key. */
export interface PurchaseResult {
  readonly success: boolean;
  /** i18n key when unsuccessful (cancellation, pending, or error). */
  readonly errorKey?: string;
}

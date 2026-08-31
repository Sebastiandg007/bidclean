/**
 * Subscriptions screen constants.
 *
 * Endpoint, entitlement/offering identifiers, platform SDK keys, and i18n keys. Identifiers and
 * keys come from configuration (never hardcoded in UI logic). The backend mirror is
 * authoritative for tier/access; the client only renders and requests.
 */

import { EntitlementKey, SubscriberRole } from './subscriptions.types';

/** Navigation route names for the subscriptions stack. */
export const SUBSCRIPTIONS_ROUTES = {
  Paywall: 'Paywall',
} as const;

/** REST endpoints. */
export const SUBSCRIPTIONS_ENDPOINTS = {
  ME: '/subscriptions/me',
} as const;

/** Platform-specific public SDK keys (client-safe; the server secret is NEVER shipped). */
export const RC_IOS_API_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY ?? '';
export const RC_ANDROID_API_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '';

/**
 * RevenueCat entitlement identifiers (its `lookup_key`), from configuration.
 * These match the backend `RC_ENTITLEMENT_*` mapping; a customerInfo entitlement is keyed here.
 */
export const RC_ENTITLEMENT_IDS: Record<EntitlementKey, string> = {
  [EntitlementKey.CLEANER_PRO]: process.env.EXPO_PUBLIC_RC_ENTITLEMENT_CLEANER_PRO ?? 'cleaner_pro',
  [EntitlementKey.HOST_PRO]: process.env.EXPO_PUBLIC_RC_ENTITLEMENT_HOST_PRO ?? 'host_pro',
  [EntitlementKey.AD_FREE]: process.env.EXPO_PUBLIC_RC_ENTITLEMENT_AD_FREE ?? 'ad_free',
};

/** RevenueCat offering identifiers per role, from configuration. */
export const RC_OFFERING_IDS: Record<SubscriberRole, string> = {
  [SubscriberRole.CLEANER]: process.env.EXPO_PUBLIC_RC_OFFERING_CLEANER_PRO ?? 'cleaner_pro',
  [SubscriberRole.HOST]: process.env.EXPO_PUBLIC_RC_OFFERING_HOST_PRO ?? 'host_pro',
};

/** i18n keys for subscription/paywall UI states. */
export const SUBSCRIPTIONS_I18N_KEYS = {
  PAYWALL_TITLE: 'subscriptions.paywall.title',
  RESTORE: 'subscriptions.paywall.restore',
  ERROR_PURCHASE_CANCELLED: 'subscriptions.error.purchase_cancelled',
  ERROR_PURCHASE_PENDING: 'subscriptions.error.purchase_pending',
  ERROR_PURCHASE_FAILED: 'subscriptions.error.purchase_failed',
  ERROR_RESTORE_FAILED: 'subscriptions.error.restore_failed',
  ERROR_OFFERING_UNAVAILABLE: 'subscriptions.error.offering_unavailable',
  ERROR_FETCH_STATUS: 'subscriptions.error.fetch_status_failed',
} as const;

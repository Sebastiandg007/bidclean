/**
 * useAdVisibility — entitlement-driven ad slot visibility.
 *
 * Reads the real `ad_free` entitlement from the server-authoritative subscription view. Users
 * WITH `ad_free` see no ads; users WITHOUT it see ads. `ad_free` is an independent entitlement
 * and does NOT imply PRO (a user can be PRO without ad_free, or ad_free without PRO). The check
 * is abstracted through the entitlement key so tier names can change without touching Radar.
 */

import { useSubscriptionStore } from '../../subscriptions/useSubscription';
import { EntitlementKey } from '../../subscriptions/subscriptions.types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdVisibilityState {
  /** Whether ads should be shown to this user */
  adsEnabled: boolean;
  /** Whether the entitlement check is still loading */
  isLoading: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Entitlement key that grants an ad-free experience (abstracted from tier names). */
const AD_FREE_ENTITLEMENT_KEY = EntitlementKey.AD_FREE;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Determines whether ad slots should be visible for the current user.
 *
 * - Reads the server-authoritative subscription view (fed by the RevenueCat mirror).
 * - If the user HAS the `ad_free` entitlement active -> adsEnabled = false (no ads).
 * - If not -> adsEnabled = true (free-tier users see ads).
 * - While the view has not loaded yet, reports loading and defaults to showing ads (the safe
 *   monetization fallback).
 */
export function useAdVisibility(): AdVisibilityState {
  const serverView = useSubscriptionStore((s) => s.serverView);
  const isLoading = useSubscriptionStore((s) => s.isLoading);

  if (serverView === null) {
    // Not yet loaded: default to showing ads (safe monetization fallback).
    return { adsEnabled: true, isLoading };
  }

  const hasAdFree = serverView.entitlements.some(
    (entitlement) => entitlement.key === AD_FREE_ENTITLEMENT_KEY && entitlement.active,
  );
  return { adsEnabled: !hasAdFree, isLoading: false };
}

// Re-export the entitlement key for testing purposes.
export { AD_FREE_ENTITLEMENT_KEY };

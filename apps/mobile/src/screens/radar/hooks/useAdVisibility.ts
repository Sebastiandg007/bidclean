/**
 * useAdVisibility — Abstracted entitlement hook for ad slot visibility.
 *
 * Checks whether ads should be displayed via an `adsEnabled` flag
 * derived from the entitlement layer (RevenueCat). Does NOT check
 * `cleaner_pro` directly — uses an abstracted entitlement so names
 * can change without modifying Radar code.
 *
 * When RevenueCat SDK is fully integrated, this hook will query the
 * customer's active entitlements for an "ad_free" entitlement.
 * Users WITH the entitlement see no ads; users WITHOUT see ads.
 */

import { useEffect, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdVisibilityState {
  /** Whether ads should be shown to this user */
  adsEnabled: boolean;
  /** Whether the entitlement check is still loading */
  isLoading: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Entitlement identifier that grants ad-free experience.
 * Abstracted from specific subscription tier names.
 */
const AD_FREE_ENTITLEMENT_ID = 'ad_free';

/**
 * Simulated loading delay for entitlement check (ms).
 * Removed when real RevenueCat SDK is integrated.
 */
const MOCK_LOADING_DELAY_MS = 100;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Determines whether ad slots should be visible for the current user.
 *
 * Implementation:
 * - Checks the entitlement layer for an `ad_free` entitlement
 * - If the user HAS the entitlement → adsEnabled = false (no ads)
 * - If the user does NOT have the entitlement → adsEnabled = true (show ads)
 *
 * Currently uses a placeholder implementation that defaults to
 * `adsEnabled: true` (free-tier behavior). Replace with RevenueCat
 * `Purchases.getCustomerInfo()` when SDK integration is complete.
 */
export function useAdVisibility(): AdVisibilityState {
  const [adsEnabled, setAdsEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function checkEntitlement(): Promise<void> {
      try {
        // TODO(BID-RC): Replace with RevenueCat entitlement check:
        // const customerInfo = await Purchases.getCustomerInfo();
        // const hasAdFree = AD_FREE_ENTITLEMENT_ID in customerInfo.entitlements.active;
        // setAdsEnabled(!hasAdFree);

        // Placeholder: simulate async entitlement check.
        // Defaults to adsEnabled = true (free-tier users see ads).
        await new Promise((resolve) => setTimeout(resolve, MOCK_LOADING_DELAY_MS));

        if (isMounted) {
          const hasAdFreeEntitlement = false; // Placeholder: no entitlement = free tier
          setAdsEnabled(!hasAdFreeEntitlement);
        }
      } catch {
        // On error, default to showing ads (safe fallback for monetization)
        if (isMounted) {
          setAdsEnabled(true);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    checkEntitlement();

    return () => {
      isMounted = false;
    };
  }, []);

  return { adsEnabled, isLoading };
}

// Re-export the entitlement ID for testing purposes
export { AD_FREE_ENTITLEMENT_ID };

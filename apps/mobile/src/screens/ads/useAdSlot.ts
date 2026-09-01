/**
 * useAdSlot — per-slot lifecycle + the layered render decision.
 *
 * Computes `shouldRender = adsEnabled AND providerReady AND placementAllowed AND consentResolved`
 * (Req 1.2 / P1). Eligibility (`adsEnabled`) comes ONLY from `useAdVisibility` (`ad_free`) — no
 * PRO/tier is read here (P1).
 *
 * Request-once-per-mount and release-on-unmount (Req 6.1 / 6.4 / P13) are realized by the render
 * topology, not by imperative calls here: a resolved slot mounts exactly one `AdBanner`, which
 * mounts exactly one native ad view owned by the provider adapter (`AdMobAdProvider`). A live list
 * re-render does not remount `AdBanner`, so the ad is not re-requested; unmounting the slot
 * unmounts the native view, which the adapter tears down. This hook therefore stays a pure
 * selector of the render decision + provider bindings and holds no imperative lifecycle state.
 *
 * The MVP surface is the Cleaner radar list, so `placementAllowed` is asserted for the known
 * radar slot key — making the Cleaner-only invariant explicit rather than incidental (Req 1.7 /
 * P11). `onPaidImpression` is wired to `useAds.reportImpression`; the AdSlot never calls RevenueCat.
 */

import { useAdVisibility } from '../radar/hooks/useAdVisibility';
import { RADAR_AD_FORMAT, RADAR_AD_SLOT_KEY } from './ads.constants';
import {
  PersonalizationMode,
  type AdFormat,
  type AdProvider,
  type PaidImpression,
} from './ads.types';
import { useAdsStore } from './useAds';

// ─── Result ────────────────────────────────────────────────────────────────────

export interface UseAdSlotResult {
  /** The layered render decision: all conditions must hold. */
  readonly shouldRender: boolean;
  readonly provider: AdProvider | null;
  readonly format: AdFormat;
  readonly personalizationMode: PersonalizationMode;
  readonly onPaidImpression: (impression: PaidImpression) => void;
  readonly onNoFill: () => void;
  readonly onError: (error: unknown) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** The MVP allows ads only in the Cleaner radar list slot (explicit Cleaner-only invariant). */
function isPlacementAllowed(slotKey: string): boolean {
  return slotKey === RADAR_AD_SLOT_KEY;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Drive a single ad slot. `slotKey` identifies the placement (only the radar list is allowed in
 * the MVP). Returns the render decision and provider bindings for `AdBanner`.
 */
export function useAdSlot(slotKey: string): UseAdSlotResult {
  const { adsEnabled } = useAdVisibility();
  const provider = useAdsStore((s) => s.provider);
  const providerReady = useAdsStore((s) => s.providerReady);
  const consentResolved = useAdsStore((s) => s.consentResolved);
  const personalizationMode = useAdsStore((s) => s.personalizationMode);
  const reportImpression = useAdsStore((s) => s.reportImpression);

  const placementAllowed = isPlacementAllowed(slotKey);
  const shouldRender =
    adsEnabled && providerReady && placementAllowed && consentResolved;

  return {
    shouldRender,
    provider,
    format: RADAR_AD_FORMAT,
    personalizationMode,
    onPaidImpression: reportImpression,
    onNoFill: () => {},
    onError: () => {},
  };
}

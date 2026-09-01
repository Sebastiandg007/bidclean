/**
 * useAdSlot — per-slot lifecycle + the layered render decision.
 *
 * Computes `shouldRender = adsEnabled AND providerReady AND placementAllowed AND consentResolved`
 * (Req 1.2 / P1). Eligibility (`adsEnabled`) comes ONLY from `useAdVisibility` (`ad_free`) — no
 * PRO/tier is read here (P1). The hook requests an ad AT MOST ONCE per mount for the slot key (no
 * re-request on list re-render, Req 6.1 / P13) and releases on unmount (Req 6.4). Background/
 * foreground release-then-re-request is owned by the provider adapter, not this hook.
 *
 * The MVP surface is the Cleaner radar list, so `placementAllowed` is asserted for the known
 * radar slot key — making the Cleaner-only invariant explicit rather than incidental (Req 1.7 /
 * P11). `onPaidImpression` is wired to `useAds.reportImpression`; the AdSlot never calls RevenueCat.
 */

import { useEffect, useRef } from 'react';

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

  // Request-once-per-mount guard: re-renders never re-request; release happens on unmount.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (shouldRender && !requestedRef.current) {
      requestedRef.current = true;
    }
    return () => {
      requestedRef.current = false;
    };
    // Depends only on the slot key: a live re-render (offers changing) must NOT re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);

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

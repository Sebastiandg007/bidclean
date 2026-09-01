/**
 * useAds — Zustand store owning the ad provider lifecycle, consent, and impression reporting.
 *
 * Mirrors the `useSubscription`/`usePayments` shape (state + actions + `reset`). It:
 *   - `initialize(appUserId, platform)`: derives the privacy-scoped attribution id, resolves
 *     consent, and initializes the factory-selected provider. Idempotent, resilient to failure
 *     (providerReady=false), and INDEPENDENT of the subscriptions lifecycle (Req 5.2–5.4 / P4).
 *   - `resolveConsent()`: reads ATT (iOS only) + UMP once per session and derives the
 *     personalization mode (Req 4.5 / P6). Consent shapes personalization, never eligibility.
 *   - `reportImpression(impression)`: delegates to the `AdRevenueTracker` (dedup + best-effort).
 *
 * Consent/native SDK access is behind guarded seams so the store runs in CI without a native
 * build; ad eligibility itself is owned by `useAdVisibility` (`ad_free`) and is NOT read here.
 */

import { create } from 'zustand';

import { deriveAdAttributionId } from './ad-attribution';
import { createAdProvider } from './ad-provider.factory';
import {
  createDefaultAdRevenueTracker,
  type AdRevenueTracker,
} from './ad-revenue-tracker';
import {
  PersonalizationMode,
  type AdPlatform,
  type AdProvider,
  type AdProviderContext,
  type ConsentState,
  type PaidImpression,
} from './ads.types';
import { readConsentState } from './consent';
import { derivePersonalizationMode } from './personalization';

// ─── State / actions ───────────────────────────────────────────────────────────

export interface AdsState {
  provider: AdProvider | null;
  providerReady: boolean;
  consent: ConsentState;
  consentResolved: boolean;
  personalizationMode: PersonalizationMode;
}

export interface AdsActions {
  /** Init the provider after auth identity is available — independent of subscriptions. */
  initialize: (appUserId: string, platform: AdPlatform) => Promise<void>;
  /** Resolve ATT (iOS) + UMP once per session, then derive the personalization mode. */
  resolveConsent: (platform: AdPlatform) => Promise<void>;
  /** Forward a paid impression to the AdRevenueTracker (dedup + best-effort, never throws). */
  reportImpression: (impression: PaidImpression) => void;
  reset: () => void;
}

export type AdsStore = AdsState & AdsActions;

// ─── Initial state ─────────────────────────────────────────────────────────────

/** Consent starts unknown on both axes until `resolveConsent` runs. */
const UNRESOLVED_CONSENT: ConsentState = {
  trackingAuthorizationStatus: 'not_determined',
  consentStatus: 'unknown',
};

const initialState: AdsState = {
  provider: null,
  providerReady: false,
  consent: UNRESOLVED_CONSENT,
  consentResolved: false,
  personalizationMode: PersonalizationMode.UNRESOLVED,
};

/** The shared tracker instance (default RevenueCat + SecureStore wiring). */
const tracker: AdRevenueTracker = createDefaultAdRevenueTracker();

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAdsStore = create<AdsStore>((set, get) => ({
  ...initialState,

  initialize: async (appUserId, platform) => {
    if (get().providerReady) {
      return; // Idempotent: already initialized this session (Req 5.3).
    }
    // Resolve consent first so the provider inits with a personalization mode when known.
    if (!get().consentResolved) {
      await get().resolveConsent(platform);
    }
    const provider = createAdProvider(platform);
    if (provider === null) {
      set({ provider: null, providerReady: false }); // Ads disabled; radar unaffected.
      return;
    }
    try {
      const context: AdProviderContext = {
        platform,
        environment: 'production',
        personalizationMode: get().personalizationMode,
        attributionId: await deriveAdAttributionId(appUserId),
      };
      await provider.initialize(context);
      set({ provider, providerReady: provider.isReady() });
    } catch {
      set({ provider: null, providerReady: false }); // Fail into "no ad shown" (Req 5.4).
    }
  },

  resolveConsent: async (platform) => {
    if (get().consentResolved) {
      return; // Once per session (Req 4.5), not per render.
    }
    const consent = await readConsentState(platform);
    set({
      consent,
      consentResolved: true,
      personalizationMode: derivePersonalizationMode(platform, consent),
    });
  },

  reportImpression: (impression) => {
    // Fire-and-forget: the tracker is best-effort and never throws into the caller (Req 3.3 / P4).
    void tracker.report(impression);
  },

  reset: () => set({ ...initialState }),
}));

/** Convenience hook returning the full ads store. */
export function useAds(): AdsStore {
  return useAdsStore();
}

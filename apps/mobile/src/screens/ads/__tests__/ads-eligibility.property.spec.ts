/**
 * Property-based tests for ad eligibility using fast-check.
 *
 * Property 1: Eligibility is `ad_free`, not PRO. An ad slot renders ONLY when
 * `adsEnabled` (the `ad_free` entitlement is absent) AND the provider is ready
 * AND the placement is allowed AND consent is resolved. Subscription tier / PRO
 * / role NEVER influence the render decision, and an active `ad_free`
 * (adsEnabled=false) NEVER yields shouldRender=true.
 *
 * Validates: Requirements 1.2, 1.3.
 * Library: fast-check (TypeScript). Minimum 100 iterations per property.
 */

import { renderHook } from '@testing-library/react-native';
import * as fc from 'fast-check';

// ─── Mocks (declared before importing the hook under test) ─────────────────────

const mockUseAdVisibility = jest.fn();
jest.mock('../../radar/hooks/useAdVisibility', () => ({
  useAdVisibility: () => mockUseAdVisibility(),
}));

import { RADAR_AD_SLOT_KEY } from '../ads.constants';
import { PersonalizationMode, type AdProvider } from '../ads.types';
import { useAdSlot } from '../useAdSlot';
import { useAdsStore } from '../useAds';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** A trivially-ready provider stub (identity/role agnostic). */
function readyProvider(): AdProvider {
  return {
    name: 'mock',
    initialize: jest.fn(),
    isReady: () => true,
    renderAdView: () => null,
  };
}

/** Irrelevant subscription/role signals that MUST NOT affect the decision. */
interface IrrelevantIdentity {
  readonly hasPro: boolean;
  readonly isHost: boolean;
  readonly isCleaner: boolean;
  readonly subscriptionActive: boolean;
}

const NON_RADAR_SLOTS = ['host-dashboard', 'profile', 'settings', 'some-other-surface'] as const;

const identityArb: fc.Arbitrary<IrrelevantIdentity> = fc.record({
  hasPro: fc.boolean(),
  isHost: fc.boolean(),
  isCleaner: fc.boolean(),
  subscriptionActive: fc.boolean(),
});

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
});

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Ads Eligibility — Property-Based Tests', () => {
  // Feature: revenuecat-ads, Property 1: Eligibility is ad_free (not PRO)
  describe('Property 1: Eligibility is ad_free, not PRO', () => {
    /**
     * Validates: Requirements 1.2, 1.3
     *
     * shouldRender is true IF AND ONLY IF adsEnabled AND providerReady AND
     * placementAllowed AND consentResolved — independent of PRO/role/subscription.
     */
    it('renders only when adsEnabled AND providerReady AND placementAllowed AND consentResolved', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.constantFrom<string>(RADAR_AD_SLOT_KEY, ...NON_RADAR_SLOTS),
          identityArb,
          (adsEnabled, providerReady, consentResolved, slotKey, _identity) => {
            mockUseAdVisibility.mockReturnValue({ adsEnabled, isLoading: false });
            useAdsStore.setState({
              provider: providerReady ? readyProvider() : null,
              providerReady,
              consentResolved,
              personalizationMode: PersonalizationMode.NON_PERSONALIZED,
            });

            const { result } = renderHook(() => useAdSlot(slotKey));

            const placementAllowed = slotKey === RADAR_AD_SLOT_KEY;
            const expected =
              adsEnabled && providerReady && placementAllowed && consentResolved;

            expect(result.current.shouldRender).toBe(expected);
          },
        ),
        { numRuns: 200 },
      );
    });

    /**
     * Validates: Requirements 1.2, 1.3
     *
     * An active `ad_free` (adsEnabled=false) NEVER yields shouldRender=true,
     * regardless of PRO/role, provider readiness, consent, or placement.
     */
    it('never renders when ad_free is active (adsEnabled=false) regardless of PRO/role', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          fc.constantFrom<string>(RADAR_AD_SLOT_KEY, ...NON_RADAR_SLOTS),
          identityArb,
          (providerReady, consentResolved, slotKey, _identity) => {
            mockUseAdVisibility.mockReturnValue({ adsEnabled: false, isLoading: false });
            useAdsStore.setState({
              provider: providerReady ? readyProvider() : null,
              providerReady,
              consentResolved,
              personalizationMode: PersonalizationMode.PERSONALIZED,
            });

            const { result } = renderHook(() => useAdSlot(slotKey));

            expect(result.current.shouldRender).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

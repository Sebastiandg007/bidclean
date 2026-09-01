/**
 * Integration test — consent gates PERSONALIZATION, not ELIGIBILITY.
 *
 * Feature: revenuecat-ads
 * Validates: Requirements 4.3, 4.4 / Property P6.
 *
 * Implemented semantics (read from `useAdSlot.ts` + `useAds.ts`):
 *   - `shouldRender = adsEnabled AND providerReady AND placementAllowed AND consentResolved`.
 *     `personalizationMode` is NOT a term of that decision — it only shapes the request the
 *     provider makes. So an eligible free user with `personalizationMode = UNRESOLVED` is STILL
 *     eligible/renderable as long as `consentResolved` is true (non-personalized serving).
 *   - `consentResolved` is a separate axis: it flips true once `resolveConsent` runs (once per
 *     session), independent of whether the derived mode is PERSONALIZED / NON_PERSONALIZED /
 *     UNRESOLVED. Until consent is resolved, no ad renders (Req 4.4).
 *   - Eligibility is owned exclusively by `useAdVisibility` (`ad_free`); consent/personalization
 *     never override it. An `ad_free` user is never shown ads regardless of consent state.
 *
 * `useAdVisibility` is mocked to control eligibility directly; the ads store is driven via
 * `setState` / `resolveConsent` to exercise the consent axis.
 */

import { renderHook } from '@testing-library/react-native';

const mockUseAdVisibility = jest.fn();
jest.mock('../../radar/hooks/useAdVisibility', () => ({
  useAdVisibility: (): { adsEnabled: boolean; isLoading: boolean } => mockUseAdVisibility(),
}));

jest.mock('../consent', () => ({
  readConsentState: async (): Promise<{
    trackingAuthorizationStatus: string;
    consentStatus: string;
  }> => ({ trackingAuthorizationStatus: 'unavailable', consentStatus: 'required' }),
}));

import { RADAR_AD_SLOT_KEY } from '../ads.constants';
import { PersonalizationMode, type AdProvider } from '../ads.types';
import { useAdSlot } from '../useAdSlot';
import { useAdsStore } from '../useAds';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readyProvider(): AdProvider {
  return {
    name: 'mock',
    initialize: jest.fn(),
    isReady: () => true,
    renderAdView: () => null,
  };
}

/** Provider ready + consent resolved, with an explicit personalization mode. */
function setStoreReady(mode: PersonalizationMode): void {
  useAdsStore.setState({
    provider: readyProvider(),
    providerReady: true,
    consentResolved: true,
    personalizationMode: mode,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
  mockUseAdVisibility.mockReturnValue({ adsEnabled: true, isLoading: false });
});

// ─── Consent shapes personalization, not eligibility ─────────────────────────

describe('consent gates personalization, not eligibility (Req 4.3 / P6)', () => {
  it('an eligible free user with UNRESOLVED personalization is still eligible once consent is resolved', () => {
    setStoreReady(PersonalizationMode.UNRESOLVED);

    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));

    // personalizationMode is UNRESOLVED but does not suppress the render decision.
    expect(result.current.personalizationMode).toBe(PersonalizationMode.UNRESOLVED);
    expect(result.current.shouldRender).toBe(true);
  });

  it('an eligible free user with NON_PERSONALIZED serving is eligible (denied tracking is still monetizable)', () => {
    setStoreReady(PersonalizationMode.NON_PERSONALIZED);

    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));

    expect(result.current.shouldRender).toBe(true);
    expect(result.current.personalizationMode).toBe(PersonalizationMode.NON_PERSONALIZED);
  });

  it('does not render until consent has been resolved (Req 4.4)', () => {
    setStoreReady(PersonalizationMode.NON_PERSONALIZED);
    useAdsStore.setState({ consentResolved: false });

    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));

    expect(result.current.shouldRender).toBe(false);
  });

  it('resolveConsent flips consentResolved true even when the derived mode is NON_PERSONALIZED (required region)', async () => {
    await useAdsStore.getState().resolveConsent('android');

    const state = useAdsStore.getState();
    expect(state.consentResolved).toBe(true);
    // UMP `required` -> NON_PERSONALIZED, yet consent IS resolved (eligibility intact).
    expect(state.personalizationMode).toBe(PersonalizationMode.NON_PERSONALIZED);
  });
});

// ─── ad_free user never sees ads regardless of consent/personalization ────────

describe('ad_free suppresses ads regardless of consent (P1 x P6)', () => {
  it.each([
    PersonalizationMode.PERSONALIZED,
    PersonalizationMode.NON_PERSONALIZED,
    PersonalizationMode.UNRESOLVED,
  ])('is false for an ad_free user with personalizationMode=%s', (mode) => {
    setStoreReady(mode);
    mockUseAdVisibility.mockReturnValue({ adsEnabled: false, isLoading: false });

    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));

    expect(result.current.shouldRender).toBe(false);
  });
});

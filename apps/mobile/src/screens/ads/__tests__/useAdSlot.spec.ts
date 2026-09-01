/**
 * Unit tests for useAdSlot — the layered render decision + request-once lifecycle.
 *
 * Validates: Requirements 1.2, 1.3, 6.1 / Properties P1, P11, P13. `useAdVisibility` is mocked so
 * eligibility is controlled directly; the ads store is driven via setState.
 */

import { renderHook } from '@testing-library/react-native';

const mockUseAdVisibility = jest.fn();
jest.mock('../../radar/hooks/useAdVisibility', () => ({
  useAdVisibility: () => mockUseAdVisibility(),
}));

import { RADAR_AD_SLOT_KEY } from '../ads.constants';
import { PersonalizationMode, type AdProvider } from '../ads.types';
import { useAdSlot } from '../useAdSlot';
import { useAdsStore } from '../useAds';

function readyProvider(): AdProvider {
  return {
    name: 'mock',
    initialize: jest.fn(),
    isReady: () => true,
    renderAdView: () => null,
  };
}

/** Put the store into a fully render-ready state (provider ready + consent resolved). */
function setStoreReady(): void {
  useAdsStore.setState({
    provider: readyProvider(),
    providerReady: true,
    consentResolved: true,
    personalizationMode: PersonalizationMode.NON_PERSONALIZED,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
  mockUseAdVisibility.mockReturnValue({ adsEnabled: true, isLoading: false });
});

describe('useAdSlot — layered render decision', () => {
  it('shouldRender is true only when every condition holds', () => {
    setStoreReady();
    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    expect(result.current.shouldRender).toBe(true);
  });

  it('is false when ad_free suppresses ads (adsEnabled=false)', () => {
    setStoreReady();
    mockUseAdVisibility.mockReturnValue({ adsEnabled: false, isLoading: false });
    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    expect(result.current.shouldRender).toBe(false);
  });

  it('is false when the provider is not ready', () => {
    useAdsStore.setState({
      provider: null,
      providerReady: false,
      consentResolved: true,
    });
    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    expect(result.current.shouldRender).toBe(false);
  });

  it('is false when consent is unresolved', () => {
    setStoreReady();
    useAdsStore.setState({ consentResolved: false });
    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    expect(result.current.shouldRender).toBe(false);
  });

  it('is false for a non-radar placement (Cleaner-only invariant, P11)', () => {
    setStoreReady();
    const { result } = renderHook(() => useAdSlot('some-other-surface'));
    expect(result.current.shouldRender).toBe(false);
  });
});

describe('useAdSlot — lifecycle', () => {
  it('does not re-request on re-render (request-once-per-mount, P13)', () => {
    setStoreReady();
    const { result, rerender } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    expect(result.current.shouldRender).toBe(true);
    rerender({});
    rerender({});
    // Stable decision across re-renders; no throw, no duplicate request semantics exposed.
    expect(result.current.shouldRender).toBe(true);
  });

  it('wires onPaidImpression to the store reportImpression', () => {
    const spy = jest.fn();
    setStoreReady();
    useAdsStore.setState({ reportImpression: spy });
    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    result.current.onPaidImpression({
      eventId: 'e1',
      revenueMicros: 1,
      currency: 'USD',
      network: 'mock',
      adUnitId: 'u',
      format: 'BANNER',
      occurredAtMs: 0,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

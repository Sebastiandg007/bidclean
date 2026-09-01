/**
 * Integration test — graceful degradation (no-fill and provider init failure).
 *
 * Feature: revenuecat-ads
 * Validates: Requirements 1.5, 5.4 / Property P7.
 *
 * (a) No-fill: a MockAdProvider variant whose `renderAdView` invokes `props.onNoFill()` and
 *     returns null. `AdBanner` must COLLAPSE (no "ad-banner" node) and nothing must throw, so the
 *     surrounding list stays intact.
 * (b) Provider init failure: `useAdsStore.initialize` with a factory-provided provider whose
 *     `initialize` rejects. The store must fail safe (providerReady=false, provider=null), and the
 *     layered render decision (`useAdSlot`) must be false -> radar renders offers only, no crash.
 *
 * `../ad-provider.factory` is mocked (same seam `useAds.spec.ts` uses) to inject the failing
 * provider; `../consent` and `../ad-attribution` are stubbed so the store runs without native SDKs.
 * `react-i18next` is stubbed only for the AdBanner render path.
 */

import { render } from '@testing-library/react-native';
import { renderHook } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key }),
}));

const mockCreateAdProvider = jest.fn();
jest.mock('../ad-provider.factory', () => ({
  createAdProvider: (...args: unknown[]): unknown => mockCreateAdProvider(...args),
}));

jest.mock('../consent', () => ({
  readConsentState: async (): Promise<{
    trackingAuthorizationStatus: string;
    consentStatus: string;
  }> => ({ trackingAuthorizationStatus: 'unavailable', consentStatus: 'obtained' }),
}));

jest.mock('../ad-attribution', () => ({
  deriveAdAttributionId: async (id: string): Promise<string> => `attr:${id}`,
}));

// `useAdVisibility` is mocked so eligibility is controlled directly (the real ad_free path is
// covered by integration-eligibility.spec.tsx); here we isolate the degradation behavior.
const mockUseAdVisibility = jest.fn();
jest.mock('../../radar/hooks/useAdVisibility', () => ({
  useAdVisibility: (): { adsEnabled: boolean; isLoading: boolean } => mockUseAdVisibility(),
}));

import { AdBanner } from '../components/AdBanner';
import { RADAR_AD_FORMAT, RADAR_AD_SLOT_KEY } from '../ads.constants';
import {
  PersonalizationMode,
  type AdProvider,
  type AdProviderContext,
  type AdViewProps,
} from '../ads.types';
import { useAdSlot } from '../useAdSlot';
import { useAdsStore } from '../useAds';

// ─── Provider variants ───────────────────────────────────────────────────────

/** A ready provider whose renderAdView immediately signals no-fill and returns null. */
function noFillProvider(): AdProvider {
  return {
    name: 'mock-no-fill',
    initialize: jest.fn<Promise<void>, [AdProviderContext]>().mockResolvedValue(undefined),
    isReady: () => true,
    renderAdView: (props: AdViewProps): null => {
      props.onNoFill();
      return null;
    },
  };
}

/** A provider whose initialize rejects (simulating an SDK init failure). */
function failingInitProvider(): AdProvider {
  return {
    name: 'mock-failing-init',
    initialize: jest
      .fn<Promise<void>, [AdProviderContext]>()
      .mockRejectedValue(new Error('init failed')),
    isReady: () => false,
    renderAdView: () => null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
  mockUseAdVisibility.mockReturnValue({ adsEnabled: true, isLoading: false });
});

// ─── (a) No-fill collapses the banner ────────────────────────────────────────

describe('no-fill degradation (Req 1.5 / P7)', () => {
  it('collapses AdBanner (no "ad-banner") and does not throw', () => {
    const provider = noFillProvider();

    // Built with `createElement` (not JSX) so this stays a `.ts` file per the file spec.
    const renderBanner = (): ReturnType<typeof render> =>
      render(
        React.createElement(AdBanner, {
          provider,
          format: RADAR_AD_FORMAT,
          personalizationMode: PersonalizationMode.NON_PERSONALIZED,
          onPaidImpression: jest.fn(),
        }),
      );

    expect(renderBanner).not.toThrow();
    const { queryByTestId } = renderBanner();
    expect(queryByTestId('ad-banner')).toBeNull();
  });
});

// ─── (b) Provider init failure fails safe ────────────────────────────────────

describe('provider init failure degradation (Req 5.4 / P7)', () => {
  it('leaves providerReady=false and shouldRender=false without crashing', async () => {
    mockCreateAdProvider.mockReturnValue(failingInitProvider());

    await useAdsStore.getState().initialize('user-1', 'android');

    expect(useAdsStore.getState().providerReady).toBe(false);
    expect(useAdsStore.getState().provider).toBeNull();

    const { result } = renderHook(() => useAdSlot(RADAR_AD_SLOT_KEY));
    expect(result.current.shouldRender).toBe(false);
    expect(result.current.provider).toBeNull();
  });
});

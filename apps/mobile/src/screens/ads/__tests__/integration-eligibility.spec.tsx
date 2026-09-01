/**
 * Integration test — ad ELIGIBILITY through the real `useAdVisibility` + `ad_free` path.
 *
 * Feature: revenuecat-ads
 * Validates: Requirements 1.1, 1.2 / Property P1.
 *
 * This test drives the REAL `useAdVisibility` hook by seeding the subscription store's
 * server-authoritative view (`serverView.entitlements`) with / without an active `ad_free`
 * entitlement, then renders the radar `AdSlot` end-to-end (AdSlot -> useAdSlot -> AdBanner ->
 * MockAdProvider). We deliberately do NOT mock `useAdVisibility` here so the real `ad_free`
 * eligibility authority is exercised; only `react-i18next` is stubbed (standard in this repo).
 * The ads store is put into a fully render-ready state via `setState`.
 */

import { render } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key }),
}));

import { AdSlot } from '../../radar/components/list/AdSlot';
import { MockAdProvider, MOCK_AD_VIEW_TEST_ID } from '../providers/mock.provider';
import { PersonalizationMode, type AdProvider } from '../ads.types';
import { useAdsStore } from '../useAds';
import { useSubscriptionStore } from '../../subscriptions/useSubscription';
import {
  EntitlementKey,
  SubscriberTier,
  type EntitlementState,
} from '../../subscriptions/subscriptions.types';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** A MockAdProvider already initialized so `isReady()` is true. */
function readyMockProvider(): AdProvider {
  const provider = new MockAdProvider();
  // MockAdProvider.initialize only flips a boolean; run it synchronously via the store setup.
  void provider.initialize({ platform: 'android', environment: 'production' });
  return provider;
}

/** Put the ads store into a fully render-ready state (provider ready + consent resolved). */
function setAdsStoreReady(): void {
  useAdsStore.setState({
    provider: readyMockProvider(),
    providerReady: true,
    consentResolved: true,
    personalizationMode: PersonalizationMode.NON_PERSONALIZED,
  });
}

/** Seed the subscription server view with the given active entitlement keys. */
function seedServerView(activeKeys: readonly EntitlementKey[]): void {
  const entitlements: EntitlementState[] = activeKeys.map((key) => ({
    key,
    active: true,
    expiresAt: null,
    store: 'app_store',
  }));
  useSubscriptionStore.setState({
    isLoading: false,
    serverView: {
      tier: SubscriberTier.FREE,
      roleTiers: { HOST: SubscriberTier.FREE, CLEANER: SubscriberTier.FREE },
      entitlements,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
  useSubscriptionStore.getState().reset();
});

describe('AdSlot eligibility via the real ad_free path', () => {
  it('renders the ad when ad_free is ABSENT (free user is eligible)', () => {
    seedServerView([]);
    setAdsStoreReady();

    const { queryByTestId } = render(<AdSlot />);

    expect(queryByTestId('ad-slot')).not.toBeNull();
    expect(queryByTestId('ad-banner')).not.toBeNull();
    expect(queryByTestId(MOCK_AD_VIEW_TEST_ID)).not.toBeNull();
  });

  it('renders NOTHING when ad_free is ACTIVE (never shown ads)', () => {
    seedServerView([EntitlementKey.AD_FREE]);
    setAdsStoreReady();

    const { queryByTestId } = render(<AdSlot />);

    expect(queryByTestId('ad-slot')).toBeNull();
    expect(queryByTestId('ad-banner')).toBeNull();
    expect(queryByTestId(MOCK_AD_VIEW_TEST_ID)).toBeNull();
  });

  it('still shows ads to a free Cleaner who holds host_pro but NOT ad_free (P1: ad_free != PRO)', () => {
    seedServerView([EntitlementKey.HOST_PRO]);
    setAdsStoreReady();

    const { queryByTestId } = render(<AdSlot />);

    expect(queryByTestId('ad-slot')).not.toBeNull();
    expect(queryByTestId(MOCK_AD_VIEW_TEST_ID)).not.toBeNull();
  });
});

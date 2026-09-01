/**
 * Unit tests for the useAds store.
 *
 * Validates: Requirements 4.5, 5.2, 5.3, 5.4 / Properties P4, P6. The provider factory, consent
 * reader, and revenue tracker are mocked so the store is tested in isolation without a native SDK.
 */

import type { AdProvider } from '../ads.types';
import { PersonalizationMode } from '../ads.types';

// ─── Mocks (declared before importing the store) ───────────────────────────────

jest.mock('../ad-revenue-tracker', () => {
  const report = jest.fn();
  return {
    __report: report,
    createDefaultAdRevenueTracker: () => ({
      report,
      getDiagnostics: () => ({
        reportedCount: 0,
        duplicateCount: 0,
        lastReportedAtMs: null,
      }),
    }),
  };
});

const mockCreateAdProvider = jest.fn();
jest.mock('../ad-provider.factory', () => ({
  createAdProvider: (...args: unknown[]) => mockCreateAdProvider(...args),
  resolveAdEnvironment: () => 'production',
}));

const mockReadConsentState = jest.fn();
jest.mock('../consent', () => ({
  readConsentState: (...args: unknown[]) => mockReadConsentState(...args),
}));

jest.mock('../ad-attribution', () => ({
  deriveAdAttributionId: async (id: string) => `attr:${id}`,
}));

import { useAdsStore } from '../useAds';

// Retrieve the hoisted report spy from the mocked module.
const { __report: mockReport } = jest.requireMock('../ad-revenue-tracker') as {
  __report: jest.Mock;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(ready: boolean): AdProvider {
  return {
    name: 'mock',
    initialize: jest.fn().mockResolvedValue(undefined),
    isReady: () => ready,
    renderAdView: () => null,
  };
}

const APP_USER_ID = 'user-123';

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
  mockReadConsentState.mockResolvedValue({
    trackingAuthorizationStatus: 'unavailable',
    consentStatus: 'obtained',
  });
});

// ─── resolveConsent ────────────────────────────────────────────────────────────

describe('useAds.resolveConsent', () => {
  it('resolves consent and derives a platform-aware personalization mode', async () => {
    await useAdsStore.getState().resolveConsent('android');
    const state = useAdsStore.getState();
    expect(state.consentResolved).toBe(true);
    expect(state.personalizationMode).toBe(PersonalizationMode.PERSONALIZED);
  });

  it('resolves at most once per session', async () => {
    await useAdsStore.getState().resolveConsent('android');
    await useAdsStore.getState().resolveConsent('android');
    expect(mockReadConsentState).toHaveBeenCalledTimes(1);
  });
});

// ─── initialize ────────────────────────────────────────────────────────────────

describe('useAds.initialize', () => {
  it('initializes the factory provider and marks it ready', async () => {
    const provider = makeProvider(true);
    mockCreateAdProvider.mockReturnValue(provider);
    await useAdsStore.getState().initialize(APP_USER_ID, 'ios');
    expect(provider.initialize).toHaveBeenCalledTimes(1);
    expect(useAdsStore.getState().providerReady).toBe(true);
  });

  it('is idempotent — a second call does not re-create the provider', async () => {
    mockCreateAdProvider.mockReturnValue(makeProvider(true));
    await useAdsStore.getState().initialize(APP_USER_ID, 'ios');
    await useAdsStore.getState().initialize(APP_USER_ID, 'ios');
    expect(mockCreateAdProvider).toHaveBeenCalledTimes(1);
  });

  it('sets providerReady=false when the factory disables ads (null provider)', async () => {
    mockCreateAdProvider.mockReturnValue(null);
    await useAdsStore.getState().initialize(APP_USER_ID, 'ios');
    expect(useAdsStore.getState().providerReady).toBe(false);
    expect(useAdsStore.getState().provider).toBeNull();
  });

  it('sets providerReady=false when provider initialization throws (Req 5.4)', async () => {
    const failing = makeProvider(false);
    (failing.initialize as jest.Mock).mockRejectedValue(new Error('init failed'));
    mockCreateAdProvider.mockReturnValue(failing);
    await useAdsStore.getState().initialize(APP_USER_ID, 'ios');
    expect(useAdsStore.getState().providerReady).toBe(false);
  });

  it('passes a privacy-scoped attributionId (not the raw id) into the provider context', async () => {
    const provider = makeProvider(true);
    mockCreateAdProvider.mockReturnValue(provider);
    await useAdsStore.getState().initialize(APP_USER_ID, 'ios');
    const context = (provider.initialize as jest.Mock).mock.calls[0][0];
    expect(context.attributionId).toBe(`attr:${APP_USER_ID}`);
    expect(context.attributionId).not.toBe(APP_USER_ID);
  });
});

// ─── reportImpression ────────────────────────────────────────────────────────────

describe('useAds.reportImpression', () => {
  it('delegates to the tracker and never throws', () => {
    const impression = {
      eventId: 'evt-1',
      revenueMicros: 1000,
      currency: 'USD',
      network: 'mock',
      adUnitId: 'mock/banner',
      format: 'BANNER' as const,
      occurredAtMs: 0,
    };
    expect(() => useAdsStore.getState().reportImpression(impression)).not.toThrow();
    expect(mockReport).toHaveBeenCalledWith(impression);
  });
});

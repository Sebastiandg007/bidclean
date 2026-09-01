/**
 * Unit tests for the provider factory selection matrix + MockAdProvider.
 *
 * Validates: Requirements 2.4, 7.4 / Properties P3, P8. The selection matrix is exercised through
 * the pure `selectAdProvider` (explicit inputs), so we can assert dev/prod branches without faking
 * the Jest environment. Env is unconfigured in CI, so production selection has no valid config.
 */

import { selectAdProvider } from '../ad-provider.factory';
import { AdProviderName } from '../ads.constants';
import type { AdEnvironment, AdPlatform } from '../ads.types';
import { MockAdProvider, MOCK_AD_VIEW_TEST_ID } from '../providers/mock.provider';
import { AdMobAdProvider } from '../providers/admob.provider';
import { AdFormat } from '../ads.types';

const IOS: AdPlatform = 'ios';

function select(
  environment: AdEnvironment,
  isTest: boolean,
  providerSelector: string,
) {
  return selectAdProvider({ platform: IOS, environment, isTest, providerSelector });
}

describe('selectAdProvider — selection matrix', () => {
  it('test environment → MockAdProvider regardless of selector', () => {
    expect(select('production', true, AdProviderName.ADMOB)).toBeInstanceOf(
      MockAdProvider,
    );
  });

  it('explicit mock selector → MockAdProvider even outside test', () => {
    expect(select('production', false, AdProviderName.MOCK)).toBeInstanceOf(
      MockAdProvider,
    );
  });

  it('development → AdMobAdProvider (uses test unit ids under the hood)', () => {
    expect(select('development', false, AdProviderName.ADMOB)).toBeInstanceOf(
      AdMobAdProvider,
    );
  });

  it('production with missing config → DISABLED (null), never the mock', () => {
    const provider = select('production', false, AdProviderName.ADMOB);
    expect(provider).toBeNull();
  });
});

describe('MockAdProvider', () => {
  it('initializes idempotently and reports ready', async () => {
    const provider = new MockAdProvider();
    expect(provider.isReady()).toBe(false);
    await provider.initialize({ platform: 'ios', environment: 'development' });
    await provider.initialize({ platform: 'ios', environment: 'development' });
    expect(provider.isReady()).toBe(true);
    expect(provider.name).toBe('mock');
  });

  it('renders a deterministic ad view with a stable testID', () => {
    const provider = new MockAdProvider();
    const element = provider.renderAdView({
      format: AdFormat.BANNER,
      personalizationMode: 'NON_PERSONALIZED',
      onPaidImpression: jest.fn(),
      onNoFill: jest.fn(),
      onError: jest.fn(),
    });
    expect(element).not.toBeNull();
    expect(element?.props.testID).toBe(MOCK_AD_VIEW_TEST_ID);
  });
});

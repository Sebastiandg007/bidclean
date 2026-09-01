/**
 * Component/lifecycle tests for AdMobAdProvider.renderAdView.
 *
 * Validates: Requirements 3.1, 6.4 / Properties P7, P13 (release-on-unmount). The native AdMob SDK
 * is mocked in `src/__mocks__/setup.ts` (BannerAd is a no-op component; default.initialize
 * resolves), so these exercise the real provider render/teardown wiring without a native build.
 */

import { render } from '@testing-library/react-native';

import { AdMobAdProvider } from '../providers/admob.provider';
import { PersonalizationMode, type AdViewProps } from '../ads.types';

function makeViewProps(overrides: Partial<AdViewProps> = {}): AdViewProps {
  return {
    format: 'BANNER',
    personalizationMode: PersonalizationMode.NON_PERSONALIZED,
    onPaidImpression: jest.fn(),
    onNoFill: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  };
}

describe('AdMobAdProvider.renderAdView', () => {
  it('collapses (no view, onNoFill) when the banner unit id is empty', () => {
    const provider = new AdMobAdProvider('');
    const props = makeViewProps();
    const element = provider.renderAdView(props);
    expect(element).toBeNull();
    expect(props.onNoFill).toHaveBeenCalledTimes(1);
  });

  it('renders a native banner wrapper when a unit id is present', async () => {
    const provider = new AdMobAdProvider('ca-app-pub-test/banner');
    await provider.initialize({ platform: 'android', environment: 'development' });
    const element = provider.renderAdView(makeViewProps());
    expect(element).not.toBeNull();
    if (element === null) {
      throw new Error('expected a rendered ad view');
    }
    // Rendering + unmounting the wrapper must not throw (native view teardown, Req 6.4).
    const { unmount } = render(element);
    expect(() => unmount()).not.toThrow();
  });
});

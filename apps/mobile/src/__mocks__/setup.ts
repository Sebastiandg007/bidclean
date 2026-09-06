/**
 * Global test setup — mocks for external modules used across auth screens.
 */

// Silence Reanimated warnings in test environment
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(32)),
  digestStringAsync: jest.fn().mockResolvedValue('mocked-base64-digest'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));

// RevenueCat SDK — native module; mocked so unit tests run without a prebuild/EAS build.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue({ entitlements: { active: {} } }),
    getOfferings: jest.fn().mockResolvedValue({ current: null, all: {} }),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo: { entitlements: { active: {} } } }),
    restorePurchases: jest.fn().mockResolvedValue({ entitlements: { active: {} } }),
  },
}));

// RevenueCat Paywalls UI — native module; mocked to a no-op component in tests.
// RevenueCatUI is the default export (a class with a static `Paywall` component); mirror that
// shape so screens can render <RevenueCatUI.Paywall> and tests can spy on it.
jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: {
    Paywall: () => null,
    PaywallFooterContainerView: () => null,
    presentPaywall: jest.fn().mockResolvedValue({}),
    presentPaywallIfNeeded: jest.fn().mockResolvedValue({}),
  },
}));

// Google Mobile Ads (AdMob) — native module; mocked so ad unit tests run without a prebuild/EAS
// build. Mobile Ads is the default export (an initializer); BannerAd is a no-op component; and the
// UMP consent surface (AdsConsent) resolves to a benign "not required" default in tests.
jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn().mockResolvedValue([]),
  },
  BannerAd: () => null,
  BannerAdSize: { BANNER: 'BANNER', ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER' },
  AdsConsent: {
    requestInfoUpdate: jest.fn().mockResolvedValue(undefined),
    getConsentInfo: jest.fn().mockResolvedValue({ status: 'NOT_REQUIRED' }),
  },
}));

// iOS App Tracking Transparency — native module; mocked to an undetermined-then-denied default so
// the personalization derivation stays deterministic in tests without a native prompt.
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestTrackingPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
}));

// Public OneSignal app id — read at import time by notifications.constants. Seed a deterministic
// non-secret test value so the bootstrap initializes regardless of module import order (the REST
// key is server-only and never present on the client).
process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ??= 'test-onesignal-app-id';

// expo-av — native audio module for voice notes (Spec 14). Mocked so recorder/player unit tests
// run without a prebuild/EAS build. `Audio.Recording` and `Audio.Sound` are lightweight fakes;
// permission helpers default to granted (tests override per-case for the denied path).
jest.mock('expo-av', () => {
  const mockRecordingInstance = {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    startAsync: jest.fn().mockResolvedValue(undefined),
    stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
    getURI: jest.fn().mockReturnValue('file:///tmp/voice-note.m4a'),
    setOnRecordingStatusUpdate: jest.fn(),
    getStatusAsync: jest.fn().mockResolvedValue({ isRecording: false, durationMillis: 0 }),
  };
  const mockSoundInstance = {
    playAsync: jest.fn().mockResolvedValue(undefined),
    pauseAsync: jest.fn().mockResolvedValue(undefined),
    stopAsync: jest.fn().mockResolvedValue(undefined),
    unloadAsync: jest.fn().mockResolvedValue(undefined),
    setOnPlaybackStatusUpdate: jest.fn(),
  };
  return {
    Audio: {
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      Recording: jest.fn().mockImplementation(() => mockRecordingInstance),
      Sound: {
        createAsync: jest
          .fn()
          .mockResolvedValue({ sound: mockSoundInstance, status: { isLoaded: true } }),
      },
      RecordingOptionsPresets: { HIGH_QUALITY: { android: {}, ios: {}, web: {} } },
    },
    InterruptionModeAndroid: { DoNotMix: 1 },
    InterruptionModeIOS: { DoNotMix: 1 },
  };
});

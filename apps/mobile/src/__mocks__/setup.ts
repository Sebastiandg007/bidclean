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

// LiveKit React Native SDK (Spec 15) — native WebRTC modules; mocked so call unit tests run without
// a prebuild/EAS build. Declared `virtual` because the native packages are not installed in the
// test toolchain (they resolve only in a device build). `mockRoomInstance` exposes the small surface
// `useLiveKitRoom` drives; tests can reach it via the constructor's mock return.
jest.mock(
  '@livekit/react-native',
  () => {
    const mockLocalParticipant = {
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      isMicrophoneEnabled: true,
      isCameraEnabled: false,
    };
    const mockRoomInstance = {
      localParticipant: mockLocalParticipant,
      state: 'disconnected',
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockReturnThis(),
      off: jest.fn().mockReturnThis(),
      removeAllListeners: jest.fn().mockReturnThis(),
    };
    return {
      __esModule: true,
      Room: jest.fn().mockImplementation(() => mockRoomInstance),
      Track: { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } },
      ConnectionState: {
        Disconnected: 'disconnected',
        Connecting: 'connecting',
        Connected: 'connected',
        Reconnecting: 'reconnecting',
      },
      RoomEvent: {
        Connected: 'connected',
        Disconnected: 'disconnected',
        Reconnecting: 'reconnecting',
        Reconnected: 'reconnected',
        ParticipantConnected: 'participantConnected',
        ParticipantDisconnected: 'participantDisconnected',
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        ConnectionStateChanged: 'connectionStateChanged',
      },
      registerGlobals: jest.fn(),
      AudioSession: {
        startAudioSession: jest.fn().mockResolvedValue(undefined),
        stopAudioSession: jest.fn().mockResolvedValue(undefined),
        configureAudio: jest.fn().mockResolvedValue(undefined),
      },
    };
  },
  { virtual: true },
);

jest.mock(
  '@livekit/react-native-webrtc',
  () => ({ __esModule: true, mediaDevices: {} }),
  { virtual: true },
);

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

// @rnmapbox/maps (Spec 7 radar, Spec 17 tracking) — native map module; mocked to lightweight no-op
// components so screens that render a map (and navigators that import them) load without a
// prebuild/EAS build. Render-only in the app; never a source of truth for position or arrival.
jest.mock('@rnmapbox/maps', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: unknown }) =>
    React.createElement(React.Fragment, null, children ?? null);
  const noop = () => null;
  return {
    __esModule: true,
    default: {
      MapView: passthrough,
      Camera: noop,
      PointAnnotation: passthrough,
      MarkerView: passthrough,
      ShapeSource: passthrough,
      SymbolLayer: noop,
      CircleLayer: noop,
      LineLayer: noop,
      FillLayer: noop,
      UserLocation: noop,
      Images: passthrough,
      setAccessToken: jest.fn(),
      setTelemetryEnabled: jest.fn(),
    },
  };
});

// expo-location (Spec 7 radar, Spec 17 tracking) — native geolocation; mocked so the Cleaner
// position reporter + radar location permission run without a device. Permission defaults to
// granted; a watch resolves to a removable no-op subscription (tests override per-case).
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3, Low: 1 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  getCurrentPositionAsync: jest
    .fn()
    .mockResolvedValue({ coords: { latitude: 0, longitude: 0, accuracy: 10, heading: null }, timestamp: 0 }),
}));

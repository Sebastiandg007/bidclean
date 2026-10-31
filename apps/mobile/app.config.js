/**
 * app.config.js — dynamic Expo config.
 *
 * Replaces the static app.json so native config-plugin values (Mapbox download
 * token, AdMob app id) can be injected from environment variables at build time
 * instead of being hardcoded. Every secret-ish value is read from env with a safe,
 * non-production default so an EAS build runs without first hardcoding credentials.
 *
 * Required env for a successful Android native build:
 *   - MAPBOX_DOWNLOAD_TOKEN  (Mapbox `sk.*` token with DOWNLOADS:READ scope) —
 *     WITHOUT this, Gradle fails (HTTP 401) downloading the native Mapbox SDK.
 * Optional (default to Google's official AdMob TEST app id so the APK still boots):
 *   - EXPO_PUBLIC_ADMOB_ANDROID_APP_ID / EXPO_PUBLIC_ADMOB_IOS_APP_ID
 */

/** Google's official AdMob TEST application id — safe default so the app boots without a real account. */
const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
};

module.exports = () => ({
  expo: {
    name: 'BidClean',
    slug: 'bidclean',
    owner: 'bidclean',
    version: '0.1.0',
    scheme: 'bidclean',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'tech.bidclean.app',
    },
    android: {
      package: 'tech.bidclean.app',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        '@rnmapbox/maps',
        {
          // Build-time secret (sk.*) used by Gradle to fetch the native Mapbox SDK.
          RNMapboxMapsDownloadToken: env('MAPBOX_DOWNLOAD_TOKEN', ''),
        },
      ],
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: env('EXPO_PUBLIC_ADMOB_ANDROID_APP_ID', ADMOB_TEST_APP_ID),
          iosAppId: env('EXPO_PUBLIC_ADMOB_IOS_APP_ID', ADMOB_TEST_APP_ID),
        },
      ],
      [
        '@stripe/stripe-react-native',
        {
          merchantIdentifier: 'merchant.tech.bidclean.app',
          enableGooglePay: true,
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: 'BidClean uses the camera for identity verification and checklist photos.',
          microphonePermission: 'BidClean uses the microphone for video verification.',
          recordAudioAndroid: true,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'BidClean uses your location to show nearby offers and track service arrival.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'BidClean accesses your photos to attach checklist and profile images.',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'BidClean uses Face ID to sign you in securely.',
        },
      ],
      [
        'expo-tracking-transparency',
        {
          userTrackingPermission:
            'BidClean uses this to measure ad performance. Your data is never sold.',
        },
      ],
    ],
    experiments: {
      typedRoutes: false,
    },
    extra: {
      eas: {
        projectId: 'b609e615-e417-45aa-8c92-177c523be7b7',
      },
    },
  },
});

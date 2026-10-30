/**
 * metro.config.js — Expo Metro config with web-only native-module stubbing.
 *
 * The web preview bundles the whole app with react-native-web. A handful of
 * dependencies are native-only (no web implementation) and would break the web
 * bundle at resolve time. For `platform === 'web'` we redirect those modules — and
 * the `mapbox-gl` CSS import their web entry pulls in — to an empty stub, so the
 * bundle compiles and the rest of the UI renders. Native (iOS/Android) resolution
 * is untouched: the real modules are used there.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

/** Packages with no web implementation — stubbed only on web. */
const WEB_STUBBED_MODULES = [
  '@rnmapbox/maps',
  '@livekit/react-native',
  '@livekit/react-native-webrtc',
  '@stripe/stripe-react-native',
  'react-native-google-mobile-ads',
  'react-native-purchases',
  'react-native-purchases-ui',
  'mapbox-gl/dist/mapbox-gl.css',
];

const STUB_PATH = path.resolve(__dirname, 'web-native-stub.js');

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBBED_MODULES.some((m) => moduleName === m || moduleName.startsWith(`${m}/`))) {
    return { type: 'sourceFile', filePath: STUB_PATH };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

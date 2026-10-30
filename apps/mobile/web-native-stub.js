/**
 * web-native-stub.js — an empty stand-in for native-only modules on web.
 *
 * Packages like @rnmapbox/maps, @livekit/react-native(-webrtc),
 * @stripe/stripe-react-native, react-native-google-mobile-ads and
 * react-native-purchases ship native code with no web implementation. For the
 * WEB PREVIEW we alias them to this stub so the bundle compiles; the screens that
 * use them render a placeholder instead of the native surface. This file is only
 * ever substituted for the web platform (see metro.config.js) — native builds use
 * the real modules untouched.
 */

const noop = () => undefined;

// A Proxy returns a harmless value for any property/callable access, so named and
// default imports, components, and hooks all resolve without throwing at import time.
const handler = {
  get: (_target, prop) => {
    if (prop === '__esModule') {
      return true;
    }
    if (prop === 'default') {
      return stub;
    }
    return stub;
  },
  apply: () => undefined,
  construct: () => ({}),
};

const stub = new Proxy(noop, handler);

module.exports = stub;

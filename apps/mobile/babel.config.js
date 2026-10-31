/**
 * Babel config for the BidClean mobile app (monorepo).
 *
 * In this npm monorepo `expo-router` is NOT hoisted to the root but
 * `babel-preset-expo` IS, so the preset's internal `hasModule('expo-router')`
 * (a require.resolve from the root) returns false and the plugin that replaces
 * `process.env.EXPO_ROUTER_APP_ROOT` with the routes-directory string literal
 * never registers — which breaks expo-router's `_ctx.*` `require.context` call.
 *
 * Fix: an inline plugin that performs that substitution ourselves, independent of
 * hoisting, Metro's caller, and EAS env vars. In the Jest `test` env it also
 * downlevels dynamic import() for the CommonJS runner.
 */
const path = require('node:path');

/** The app's real routes directory (apps/mobile/app). */
const APP_ROUTER_ROOT = path.join(__dirname, 'app');

/**
 * Replace `process.env.EXPO_ROUTER_APP_ROOT` reads with the absolute routes path,
 * replicating what babel-preset-expo's expo-router plugin does when it registers.
 */
function inlineExpoRouterAppRoot() {
  return {
    name: 'bidclean-inline-expo-router-app-root',
    visitor: {
      MemberExpression(nodePath) {
        const object = nodePath.get('object');
        const property = nodePath.node.property;
        const isEnvRead =
          object.matchesPattern('process.env') &&
          property &&
          property.name === 'EXPO_ROUTER_APP_ROOT';
        const isAssignmentTarget =
          nodePath.parent.type === 'AssignmentExpression' &&
          nodePath.parent.left === nodePath.node;
        if (isEnvRead && !isAssignmentTarget) {
          nodePath.replaceWith({ type: 'StringLiteral', value: APP_ROUTER_ROOT });
        }
      },
    },
  };
}

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [inlineExpoRouterAppRoot],
    env: {
      test: {
        plugins: ['babel-plugin-dynamic-import-node'],
      },
    },
  };
};

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
 * The static values babel-preset-expo would inline for expo-router's env reads.
 * `require.context` requires ALL of its arguments to be static literals, so both
 * the routes root and the import mode must be substituted.
 */
const EXPO_ROUTER_ENV_LITERALS = {
  EXPO_ROUTER_APP_ROOT: APP_ROUTER_ROOT,
  EXPO_ROUTER_IMPORT_MODE: 'sync',
};

/**
 * Replace expo-router's `process.env.EXPO_ROUTER_*` reads with static string
 * literals, replicating what babel-preset-expo's expo-router plugin does when it
 * registers (it does not here because expo-router is not hoisted).
 */
function inlineExpoRouterEnv() {
  return {
    name: 'bidclean-inline-expo-router-env',
    visitor: {
      MemberExpression(nodePath) {
        const object = nodePath.get('object');
        const property = nodePath.node.property;
        const name = property && property.name;
        const isEnvRead =
          object.matchesPattern('process.env') &&
          Object.prototype.hasOwnProperty.call(EXPO_ROUTER_ENV_LITERALS, name);
        const isAssignmentTarget =
          nodePath.parent.type === 'AssignmentExpression' &&
          nodePath.parent.left === nodePath.node;
        if (isEnvRead && !isAssignmentTarget) {
          nodePath.replaceWith({ type: 'StringLiteral', value: EXPO_ROUTER_ENV_LITERALS[name] });
        }
      },
    },
  };
}

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [inlineExpoRouterEnv],
    env: {
      test: {
        plugins: ['babel-plugin-dynamic-import-node'],
      },
    },
  };
};

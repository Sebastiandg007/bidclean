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

/** The app's real routes directory (apps/mobile/app), as an absolute path. */
const APP_ROUTER_ROOT = path.join(__dirname, 'app');

/**
 * Replace expo-router's `process.env.EXPO_ROUTER_*` reads with static literals,
 * replicating what babel-preset-expo's expo-router plugin does when it registers
 * (it does not here because expo-router is not hoisted).
 *
 * CRITICAL: `EXPO_ROUTER_APP_ROOT` must become a path RELATIVE to the `_ctx.*`
 * file being transformed (not an absolute build-machine path), because it is the
 * first argument of `require.context` — Metro resolves it like a relative
 * `require` specifier at build time. An absolute path leaves the context empty on
 * device (no routes registered → blank screen). We compute it from `state.filename`
 * exactly like the official plugin: `path.relative(dirname(file), routesDir)`.
 */
function inlineExpoRouterEnv() {
  return {
    name: 'bidclean-inline-expo-router-env',
    visitor: {
      MemberExpression(nodePath, state) {
        const object = nodePath.get('object');
        const name = nodePath.node.property && nodePath.node.property.name;
        const isAssignmentTarget =
          nodePath.parent.type === 'AssignmentExpression' &&
          nodePath.parent.left === nodePath.node;
        if (!object.matchesPattern('process.env') || isAssignmentTarget) {
          return;
        }
        if (name === 'EXPO_ROUTER_IMPORT_MODE') {
          nodePath.replaceWith({ type: 'StringLiteral', value: 'sync' });
          return;
        }
        if (name === 'EXPO_ROUTER_APP_ROOT') {
          const filename = state.filename || state.file.opts.filename;
          const fromDir = filename ? path.dirname(filename) : __dirname;
          let rel = path.relative(fromDir, APP_ROUTER_ROOT).split(path.sep).join('/');
          if (!rel.startsWith('.')) {
            rel = `./${rel}`;
          }
          nodePath.replaceWith({ type: 'StringLiteral', value: rel });
          return;
        }
        if (name === 'EXPO_ROUTER_ABS_APP_ROOT') {
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
    plugins: [inlineExpoRouterEnv],
    env: {
      test: {
        plugins: ['babel-plugin-dynamic-import-node'],
      },
    },
  };
};

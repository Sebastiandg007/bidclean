/**
 * metro.config.js — Expo Metro config for the mobile app (monorepo-aware).
 *
 * `getDefaultConfig` wires Expo's transform pipeline, which injects
 * `transform.routerRoot` so babel-preset-expo can replace
 * `process.env.EXPO_ROUTER_APP_ROOT` in expo-router's `_ctx`. We only ADD the
 * workspace root to `watchFolders` and the root `node_modules` to the resolver
 * search paths (the official Expo monorepo pattern) without overriding Expo's
 * defaults, so the router bundle resolves correctly.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: also watch the workspace root and resolve hoisted deps from it,
// preserving Expo's default watchFolders / resolution behavior.
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * Packages that register native views/modules and MUST exist once in the bundle.
 * In this monorepo npm can install two copies (e.g. react-native-safe-area-context
 * 4.12.0 under apps/mobile and 4.14.1 hoisted at the root for React Navigation),
 * and loading both crashes at startup with "Tried to register two views with the
 * same name RNCSafeAreaProvider". Every import of these packages is resolved as if
 * it came from the app itself, so only the app's copy is bundled.
 */
const SINGLETON_PACKAGES = [
  'react',
  'react-native',
  'react-native-safe-area-context',
  'react-native-screens',
  'react-native-reanimated',
];

const appOrigin = path.join(projectRoot, 'package.json');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = SINGLETON_PACKAGES.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  if (isSingleton) {
    return context.resolveRequest(
      { ...context, originModulePath: appOrigin },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

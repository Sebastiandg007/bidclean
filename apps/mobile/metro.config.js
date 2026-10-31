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

module.exports = config;

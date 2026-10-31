/**
 * metro.config.js — Expo Metro config for the mobile app (monorepo-aware).
 *
 * `getDefaultConfig` wires Expo's transform pipeline, which is what injects
 * `transform.routerRoot` and lets babel-preset-expo replace
 * `process.env.EXPO_ROUTER_APP_ROOT` in expo-router's `_ctx` — without this file
 * the router bundle fails with "require.context should be a string". The monorepo
 * tweaks make Metro watch the workspace root and resolve hoisted dependencies.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: watch the workspace root and resolve from both node_modules trees.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Avoid loading two copies of hoisted packages (e.g. expo-router) in the monorepo.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

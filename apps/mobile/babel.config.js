/**
 * Babel config for the BidClean mobile app.
 *
 * Uses Expo's preset for Metro/production. In the Jest `test` environment only, it additionally
 * downlevels dynamic `import()` to a synchronous `require` (via `babel-plugin-dynamic-import-node`)
 * so modules that lazily `await import(...)` a dependency (to avoid circular deps) can be unit
 * tested under Jest's CommonJS runner without the `--experimental-vm-modules` flag. This plugin is
 * scoped to the test env and does not affect the Metro bundle.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      test: {
        plugins: ['babel-plugin-dynamic-import-node'],
      },
    },
  };
};

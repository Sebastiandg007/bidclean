/**
 * Jest config for the config-inventory tooling. Uses ts-jest with an isolated
 * transform so the tests run from the repo root against the hoisted workspace
 * dependencies (jest, ts-jest, fast-check). Mirrors the API convention of
 * matching `*.spec.ts`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        isolatedModules: true,
        diagnostics: { ignoreCodes: [6133, 6198] },
      },
    ],
  },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!out/**'],
  coverageDirectory: '<rootDir>/coverage',
};

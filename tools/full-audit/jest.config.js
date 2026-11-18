/**
 * Jest config for the full-audit tooling. Mirrors config-inventory: ts-jest with
 * an isolated transform, run from the repo root against the hoisted workspace
 * dependencies (jest, ts-jest, fast-check, js-yaml). Matches `*.spec.ts`.
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
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!reports/**'],
  coverageDirectory: '<rootDir>/coverage',
};

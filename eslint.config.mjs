/**
 * ESLint Flat Config — BidClean Monorepo
 *
 * Applies to all TypeScript/JavaScript files across workspaces.
 * Uses the modern flat config format required by ESLint 10+.
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // ─── Global Ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/.next/',
      '**/.expo/',
    ],
  },

  // ─── Base JS Recommended Rules ─────────────────────────────────────────────
  js.configs.recommended,

  // ─── TypeScript Recommended Rules ──────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ─── Prettier (disables conflicting rules) ─────────────────────────────────
  prettier,

  // ─── TypeScript Files Configuration ────────────────────────────────────────
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ─── Test Files (relaxed rules) ────────────────────────────────────────────
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx', '**/__mocks__/**'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // ─── React Native / JSX Files ──────────────────────────────────────────────
  {
    files: ['**/apps/mobile/**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];

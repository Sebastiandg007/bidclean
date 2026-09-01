import * as fc from 'fast-check';

/**
 * Property-based tests (fast-check) for configuration integrity.
 *
 * Feature: revenuecat-subscriptions
 * Covers:
 * - Property 10: Configuration Integrity (Requirements 9.4) — production startup fails when any
 *   entitlement id mapping is missing; there is NO silent hardcoded fallback.
 *
 * The constants module reads env at import time and `validateSubscriptionsConfig` skips under
 * NODE_ENV=test, so each case loads the module in an isolated registry with NODE_ENV=production
 * and a controlled environment.
 */

const ENTITLEMENT_ENV_KEYS = [
  'RC_ENTITLEMENT_CLEANER_PRO',
  'RC_ENTITLEMENT_HOST_PRO',
  'RC_ENTITLEMENT_AD_FREE',
] as const;

interface ValidationCase {
  cleaner: string;
  host: string;
  adFree: string;
}

/** Load validateSubscriptionsConfig fresh under production with the given entitlement env. */
function runValidation(env: ValidationCase): () => void {
  let validate!: () => void;
  jest.isolateModules(() => {
    process.env.NODE_ENV = 'production';
    process.env.REVENUECAT_API_KEY = 'sk_test';
    process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET = 'signing';
    process.env.REVENUECAT_WEBHOOK_AUTH_SECRET = '';
    process.env.RC_ENTITLEMENT_CLEANER_PRO = env.cleaner;
    process.env.RC_ENTITLEMENT_HOST_PRO = env.host;
    process.env.RC_ENTITLEMENT_AD_FREE = env.adFree;
    // Positive-integer defaults are applied by the module; leave the SUBSCRIPTION_* vars unset.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('SUBSCRIPTION_') || k === 'REVENUECAT_WEBHOOK_TOLERANCE_SECONDS') {
        delete process.env[k];
      }
    }
    validate = require('../subscriptions.constants').validateSubscriptionsConfig;
  });
  return validate;
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('validateSubscriptionsConfig — properties', () => {
  it('P10: any empty entitlement mapping fails startup', () => {
    fc.assert(
      fc.property(
        fc.record({
          cleaner: fc.string(),
          host: fc.string(),
          adFree: fc.string(),
        }),
        (env) => {
          const anyEmpty = ENTITLEMENT_ENV_KEYS.length > 0 &&
            (env.cleaner.trim() === '' || env.host.trim() === '' || env.adFree.trim() === '');
          const validate = runValidation(env);
          if (anyEmpty) {
            expect(() => validate()).toThrow(/Invalid subscriptions configuration/);
          } else {
            expect(() => validate()).not.toThrow();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('P10: a complete mapping with a webhook secret and API key boots', () => {
    const validate = runValidation({ cleaner: 'cleaner_pro', host: 'host_pro', adFree: 'ad_free' });
    expect(() => validate()).not.toThrow();
  });
});

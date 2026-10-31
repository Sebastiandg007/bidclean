import * as fc from 'fast-check';

/**
 * Property-based tests (fast-check) for favorites configuration integrity.
 *
 * Feature: favorites
 *
 * `validateFavoritesConfig()` reads module-level constants that are parsed from `process.env` at
 * import time, so each case sets the env, resets the module registry, re-imports the freshly-parsed
 * constants + validator, and asserts the throw/pass. NODE_ENV is forced away from 'test' inside the
 * property (the validator early-returns under NODE_ENV=test) and restored afterwards.
 */

const FAVORITES_ENV_KEYS = [
  'FAVORITES_FREE_MAX',
  'FAVORITES_PRO_MAX',
  'FAVORITES_LIST_MAX_LIMIT',
  'FAVORITES_LIST_DEFAULT_LIMIT',
  'FAVORITES_CACHE_TTL_MS',
  'FAVORITES_EXPOSE_AGGREGATE_COUNT',
  'FAVORITES_ALLOW_ADD_WITHOUT_SERVICE',
] as const;

interface ConfigCase {
  readonly freeMax: string | undefined;
  readonly proMax: string | undefined;
  readonly listMax: string | undefined;
  readonly listDefault: string | undefined;
  readonly cacheTtl: string | undefined;
}

/** Apply a config case to process.env (clearing unset keys). */
function applyEnv(input: ConfigCase): void {
  for (const key of FAVORITES_ENV_KEYS) {
    delete process.env[key];
  }
  if (input.freeMax !== undefined) process.env.FAVORITES_FREE_MAX = input.freeMax;
  if (input.proMax !== undefined) process.env.FAVORITES_PRO_MAX = input.proMax;
  if (input.listMax !== undefined) process.env.FAVORITES_LIST_MAX_LIMIT = input.listMax;
  if (input.listDefault !== undefined) process.env.FAVORITES_LIST_DEFAULT_LIMIT = input.listDefault;
  if (input.cacheTtl !== undefined) process.env.FAVORITES_CACHE_TTL_MS = input.cacheTtl;
}

/** True iff the case is expected to be VALID per the documented rules. */
function isExpectedValid(input: ConfigCase): boolean {
  const freeMax = parseIntOr(input.freeMax, 20); // default is a positive int
  if (!Number.isInteger(freeMax) || freeMax <= 0) return false;

  if (input.proMax !== undefined && input.proMax.trim().length > 0) {
    const pro = parseInt(input.proMax, 10);
    if (!Number.isInteger(pro) || pro <= 0) return false;
  }

  const listMax = parseIntOr(input.listMax, 50);
  if (!Number.isInteger(listMax) || listMax <= 0) return false;

  const listDefault = parseIntOr(input.listDefault, 20);
  if (!Number.isInteger(listDefault) || listDefault <= 0) return false;
  if (listDefault > listMax) return false;

  if (input.cacheTtl !== undefined && input.cacheTtl.trim().length > 0) {
    const ttl = parseInt(input.cacheTtl, 10);
    if (!Number.isInteger(ttl) || ttl <= 0) return false;
  }
  return true;
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  return parseInt(raw, 10);
}

/**
 * Run the freshly-parsed validator for the given env; returns whether it threw. Forces NODE_ENV to
 * 'production' only for the duration of the call (the validator early-returns under 'test') and
 * ALWAYS restores it in a finally, so NODE_ENV never leaks to a later spec in the same worker.
 */
function runValidator(): { threw: boolean } {
  let threw = false;
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    jest.isolateModules(() => {
      const { validateFavoritesConfig } = require('../config/validate-favorites-config');
      try {
        validateFavoritesConfig();
      } catch {
        threw = true;
      }
    });
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
  }
  return { threw };
}

const optionalNumericStringArb = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(''),
  fc.integer({ min: -5, max: 100 }).map((n) => String(n)),
  fc.constant('abc'),
);

const caseArb: fc.Arbitrary<ConfigCase> = fc.record({
  freeMax: optionalNumericStringArb,
  proMax: optionalNumericStringArb,
  listMax: optionalNumericStringArb,
  listDefault: optionalNumericStringArb,
  cacheTtl: optionalNumericStringArb,
});

describe('validateFavoritesConfig — properties', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of FAVORITES_ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterAll(() => {
    // NODE_ENV is restored per-call inside runValidator; only the FAVORITES_* keys need cleanup here.
    for (const key of FAVORITES_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  // Feature: favorites, Property 11: Configuration integrity and fail-fast validation
  it('P11: throws iff a required tunable is missing/invalid; passes on a valid map', () => {
    fc.assert(
      fc.property(caseArb, (input) => {
        applyEnv(input);
        const { threw } = runValidator();
        expect(threw).toBe(!isExpectedValid(input));
      }),
      { numRuns: 150 },
    );
  });
});

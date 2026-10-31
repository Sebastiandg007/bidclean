import * as fc from 'fast-check';

import { QualifyingServiceQuery } from '../favorites.types';

/**
 * Property-based tests (fast-check) for the add-eligibility policy.
 *
 * Feature: favorites
 *
 * `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE` is a module-level constant parsed at import time, so each
 * case sets the env, isolates the module registry, and re-imports the freshly-parsed policy. The
 * Spec 20 predicate is a stubbed seam; the property asserts the decision is deterministic in
 * `(flag, hasQualifyingService)` and that favorites owns no completion logic (it only reads the
 * predicate).
 */

/** A stub predicate returning a fixed answer, recording whether it was consulted. */
function stubPredicate(answer: boolean): QualifyingServiceQuery & { consulted: boolean } {
  return {
    consulted: false,
    async hasQualifyingService(_hostId: string, _cleanerId: string): Promise<boolean> {
      this.consulted = true;
      return answer;
    },
  };
}

/** Build the freshly-parsed policy for the given flag + stubbed predicate; returns whether it threw. */
async function runPolicy(
  flag: boolean,
  predicate: QualifyingServiceQuery,
): Promise<{ threw: boolean }> {
  const saved = process.env.FAVORITES_ALLOW_ADD_WITHOUT_SERVICE;
  process.env.FAVORITES_ALLOW_ADD_WITHOUT_SERVICE = String(flag);
  let threw = false;
  await jestIsolate(async () => {
    const { FavoriteEligibilityPolicy } = require('../favorite-eligibility.policy');
    const policy = new FavoriteEligibilityPolicy(predicate);
    try {
      await policy.assertMayAdd('host-1', 'cleaner-1');
    } catch {
      threw = true;
    }
  });
  if (saved === undefined) {
    delete process.env.FAVORITES_ALLOW_ADD_WITHOUT_SERVICE;
  } else {
    process.env.FAVORITES_ALLOW_ADD_WITHOUT_SERVICE = saved;
  }
  return { threw };
}

/** `jest.isolateModules` wrapper that awaits an async body. */
async function jestIsolate(body: () => Promise<void>): Promise<void> {
  let pending: Promise<void> | undefined;
  jest.isolateModules(() => {
    pending = body();
  });
  await pending;
}

describe('FavoriteEligibilityPolicy — properties', () => {
  // Feature: favorites, Property 12: Add-eligibility policy is enforced and config-driven
  it('P12: flag true → never blocks & never consults; flag false → allowed iff qualifying service, deterministic', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (flag, hasService) => {
        const predicate = stubPredicate(hasService);
        const { threw } = await runPolicy(flag, predicate);

        if (flag) {
          // Allowed unconditionally; the predicate is never consulted (no completion logic here).
          expect(threw).toBe(false);
          expect(predicate.consulted).toBe(false);
        } else {
          // Allowed iff a qualifying service exists; otherwise 422.
          expect(threw).toBe(!hasService);
          expect(predicate.consulted).toBe(true);
        }
      }),
      { numRuns: 120 },
    );
  });
});

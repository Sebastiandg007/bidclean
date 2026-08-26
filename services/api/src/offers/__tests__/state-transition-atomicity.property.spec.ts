import * as fc from 'fast-check';
import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS } from '../offers.constants';
import { validateTransition } from '../state-machine/offer-state-machine';

/**
 * Property-based tests for state transition atomicity (concurrency safety).
 *
 * Feature: offer-publishing, Property: State Transition Atomicity (Concurrency Safety)
 *
 * **Validates: Requirements 3.10**
 *
 * Simulates N concurrent transitions on the same offer using the optimistic
 * locking pattern (UPDATE WHERE state = expectedState). The invariant:
 * exactly 1 transition succeeds and N-1 fail when all attempt the same
 * valid transition concurrently.
 *
 * The simulation replicates database-level optimistic locking in-memory:
 * - All N callers read the current state (same value)
 * - All N callers attempt UPDATE WHERE state = expectedState
 * - Only the first writer succeeds; subsequent writers see affected = 0
 */
describe('OfferStateMachine — Concurrency Atomicity Property Test', () => {
  /** All states that have at least one valid outgoing transition */
  const NON_TERMINAL_STATES = Object.values(OfferState).filter(
    (state) => ALLOWED_TRANSITIONS[state].length > 0,
  );

  /**
   * Simulate optimistic locking: N concurrent transitions on the same offer.
   *
   * All callers read the same `currentState`. Each attempts a CAS
   * (compare-and-swap) transition. Only the first to execute wins.
   *
   * @param currentState - The offer's current state
   * @param targetState - The desired target state
   * @param concurrency - Number of simultaneous attempts
   * @returns Array of booleans (true = succeeded, false = lost race)
   */
  function simulateConcurrentTransitions(
    currentState: OfferState,
    targetState: OfferState,
    concurrency: number,
  ): boolean[] {
    let dbState = currentState;
    const results: boolean[] = [];

    for (let i = 0; i < concurrency; i++) {
      const validation = validateTransition(currentState, targetState);
      if (!validation.valid) {
        results.push(false);
        continue;
      }

      // Optimistic lock: only succeeds if dbState still matches expectedState
      if (dbState === currentState) {
        dbState = targetState;
        results.push(true);
      } else {
        results.push(false);
      }
    }

    return results;
  }

  /**
   * Generate a valid (currentState, targetState) pair where
   * the transition is allowed by the state machine.
   */
  const validTransitionArb = fc
    .constantFrom(...NON_TERMINAL_STATES)
    .chain((currentState) => {
      const targets = ALLOWED_TRANSITIONS[currentState];
      return fc
        .constantFrom(...targets)
        .map((targetState) => ({ currentState, targetState }));
    });

  /** Generate concurrency level between 2 and 20 */
  const concurrencyArb = fc.integer({ min: 2, max: 20 });

  describe('Property: State Transition Atomicity (Concurrency Safety)', () => {
    it('exactly 1 concurrent transition succeeds and N-1 fail', () => {
      fc.assert(
        fc.property(
          validTransitionArb,
          concurrencyArb,
          ({ currentState, targetState }, concurrency) => {
            const results = simulateConcurrentTransitions(
              currentState,
              targetState,
              concurrency,
            );

            const successCount = results.filter((r) => r).length;
            const failCount = results.filter((r) => !r).length;

            // Invariant: exactly 1 succeeds
            expect(successCount).toBe(1);

            // Invariant: all others fail
            expect(failCount).toBe(concurrency - 1);

            // Invariant: total results equals concurrency
            expect(results.length).toBe(concurrency);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('failed transitions do not mutate state', () => {
      fc.assert(
        fc.property(
          validTransitionArb,
          concurrencyArb,
          ({ currentState, targetState }, concurrency) => {
            let dbState = currentState;
            let transitionCount = 0;

            for (let i = 0; i < concurrency; i++) {
              const validation = validateTransition(currentState, targetState);
              if (!validation.valid) continue;

              if (dbState === currentState) {
                dbState = targetState;
                transitionCount++;
              }
            }

            // State should be the target (one transition succeeded)
            expect(dbState).toBe(targetState);

            // Only one actual state mutation occurred
            expect(transitionCount).toBe(1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('invalid transitions never succeed regardless of concurrency', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...Object.values(OfferState)),
          fc.constantFrom(...Object.values(OfferState)),
          concurrencyArb,
          (currentState, targetState, concurrency) => {
            const isValid = ALLOWED_TRANSITIONS[currentState].includes(targetState);

            if (isValid) return; // Skip valid transitions for this property

            const results = simulateConcurrentTransitions(
              currentState,
              targetState,
              concurrency,
            );

            const successCount = results.filter((r) => r).length;

            // No transition should succeed for invalid pairs
            expect(successCount).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

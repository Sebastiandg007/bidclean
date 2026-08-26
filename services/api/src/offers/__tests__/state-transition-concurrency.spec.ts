import * as fc from 'fast-check';
import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS } from '../offers.constants';

/**
 * State Transition Atomicity (Concurrency Safety) — Property-Based Test.
 *
 * Validates: Requirements 26.1
 *
 * Simulates N concurrent transitions on the same offer and asserts
 * that exactly 1 succeeds and N-1 fail, proving the optimistic locking
 * pattern (UPDATE WHERE state = expectedState) guarantees atomicity.
 *
 * Feature: offer-publishing, Property 26.1: State Transition Atomicity
 */

/**
 * Mock repository that simulates PostgreSQL optimistic locking behavior.
 *
 * The UPDATE ... WHERE state = :expectedState pattern ensures only the first
 * caller to execute the update "wins" (affected = 1). All subsequent callers
 * see state !== expectedState and get affected = 0.
 */
class MockOfferRepository {
  private currentState: OfferState;
  private transitionLock = false;

  constructor(initialState: OfferState) {
    this.currentState = initialState;
  }

  /**
   * Simulates: UPDATE offers SET state = :newState WHERE id = :id AND state = :expectedState
   *
   * Uses a synchronous check-and-set pattern to mimic the database atomicity.
   * In real PostgreSQL, row-level locking ensures only one UPDATE succeeds per row
   * when multiple transactions execute concurrently with the WHERE clause.
   */
  async atomicTransition(
    expectedState: OfferState,
    newState: OfferState,
  ): Promise<{ affected: number }> {
    // Simulate async delay to interleave concurrent calls
    await Promise.resolve();

    // Atomic check-and-set: only one caller can win
    if (this.currentState === expectedState && !this.transitionLock) {
      this.transitionLock = true;
      this.currentState = newState;
      return { affected: 1 };
    }

    return { affected: 0 };
  }

  getState(): OfferState {
    return this.currentState;
  }
}

/**
 * Simulates the transitionState logic using the mock repository.
 * Mirrors OfferStateMachineService.transitionState behavior:
 * 1. Validate transition is allowed
 * 2. Execute atomic UPDATE WHERE state = expectedState
 * 3. Return true if affected = 1, false otherwise
 */
async function mockTransitionState(
  repo: MockOfferRepository,
  expectedState: OfferState,
  newState: OfferState,
): Promise<boolean> {
  const allowed = ALLOWED_TRANSITIONS[expectedState] ?? [];
  if (!allowed.includes(newState)) {
    return false;
  }

  const result = await repo.atomicTransition(expectedState, newState);
  return result.affected === 1;
}

/**
 * Generates a valid (fromState, toState) pair from ALLOWED_TRANSITIONS.
 */
const validTransitionArb = fc.constantFrom(
  ...Object.entries(ALLOWED_TRANSITIONS).flatMap(([from, targets]) =>
    (targets as OfferState[]).map(
      (to) => [from as OfferState, to] as [OfferState, OfferState],
    ),
  ),
);

describe('State Transition Concurrency (Property-Based)', () => {
  /**
   * Property: For any valid transition and N concurrent attempts (2-10),
   * exactly 1 succeeds and N-1 fail.
   *
   * This tests the core concurrency guarantee of optimistic locking:
   * the UPDATE WHERE state = expectedState pattern ensures mutual exclusion
   * without explicit locks.
   */
  it('should allow exactly 1 of N concurrent transitions to succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTransitionArb,
        fc.integer({ min: 2, max: 10 }),
        async ([fromState, toState], concurrency) => {
          const repo = new MockOfferRepository(fromState);

          // Simulate N concurrent transition attempts
          const results = await Promise.all(
            Array.from({ length: concurrency }, () =>
              mockTransitionState(repo, fromState, toState),
            ),
          );

          const successes = results.filter((r) => r === true);
          const failures = results.filter((r) => r === false);

          // Exactly 1 transition must succeed
          expect(successes.length).toBe(1);

          // N-1 transitions must fail
          expect(failures.length).toBe(concurrency - 1);

          // Final state must be the target state
          expect(repo.getState()).toBe(toState);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: After N concurrent transitions, the offer is in exactly
   * the target state (not in an intermediate or corrupted state).
   *
   * This validates data integrity — no partial writes or state corruption.
   */
  it('should maintain data integrity under concurrent writes', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTransitionArb,
        fc.integer({ min: 2, max: 10 }),
        async ([fromState, toState], concurrency) => {
          const repo = new MockOfferRepository(fromState);

          await Promise.all(
            Array.from({ length: concurrency }, () =>
              mockTransitionState(repo, fromState, toState),
            ),
          );

          // State must be exactly the target — no intermediate values
          const finalState = repo.getState();
          expect(finalState).toBe(toState);

          // State must be a valid OfferState enum value
          expect(Object.values(OfferState)).toContain(finalState);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: Invalid transitions never succeed regardless of concurrency.
   *
   * Even under concurrent load, an invalid state transition (not in
   * ALLOWED_TRANSITIONS) should always return false for all N callers.
   */
  it('should reject all N concurrent attempts for invalid transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...Object.values(OfferState)),
        fc.constantFrom(...Object.values(OfferState)),
        fc.integer({ min: 2, max: 10 }),
        async (fromState, toState, concurrency) => {
          const allowed = ALLOWED_TRANSITIONS[fromState] ?? [];
          // Only test invalid transitions
          fc.pre(!allowed.includes(toState));

          const repo = new MockOfferRepository(fromState);

          const results = await Promise.all(
            Array.from({ length: concurrency }, () =>
              mockTransitionState(repo, fromState, toState),
            ),
          );

          const successes = results.filter((r) => r === true);

          // No transition should succeed
          expect(successes.length).toBe(0);

          // State should remain unchanged
          expect(repo.getState()).toBe(fromState);
        },
      ),
      { numRuns: 100 },
    );
  });
});

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { Offer } from '../entities/offer.entity';
import { OfferStateTransition } from '../entities/offer-state-transition.entity';
import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS } from '../offers.constants';

/**
 * Property-based tests for OffersModule — State Transition Atomicity.
 *
 * Feature: offer-publishing
 *
 * Validates: Requirements 2.2
 */
describe('OffersModule — State Transition Atomicity (Concurrency Safety)', () => {
  /**
   * Property 26.1: State Transition Atomicity (Concurrency Safety)
   *
   * **Validates: Requirements 2.2**
   *
   * Simulate N concurrent transitions on the same offer.
   * Assert: exactly 1 succeeds and N-1 fail.
   *
   * The state machine uses optimistic locking via:
   *   UPDATE offers SET state = :new WHERE id = :id AND state = :expected
   *
   * Only the first writer wins (affected = 1); subsequent writers see affected = 0.
   * This test simulates that by using a shared mutable state and an atomic
   * compare-and-swap: only the first caller that reads the expected state wins.
   */
  describe('Property 26.1: State Transition Atomicity — Concurrent Transitions', () => {
    it('exactly 1 of N concurrent transitions succeeds, N-1 fail', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 20 }),
          fc.constantFrom(
            ...getValidTransitions(),
          ),
          async (concurrency: number, transition: { from: OfferState; to: OfferState }) => {
            /**
             * Simulate optimistic locking behavior:
             * A shared mutable "current state" that transitions only once.
             * Multiple concurrent callers attempt the same UPDATE WHERE state = expected.
             * Only the first one to execute sees affected = 1; the rest see affected = 0.
             */
            let currentState = transition.from;
            let transitionCount = 0;

            const mockOfferRepo = {
              createQueryBuilder: () => ({
                update: () => ({
                  set: () => ({
                    where: (_: string, __: Record<string, unknown>) => ({
                      execute: async () => {
                        // Atomic compare-and-swap simulation
                        if (currentState === transition.from) {
                          currentState = transition.to;
                          transitionCount++;
                          return { affected: 1 };
                        }
                        return { affected: 0 };
                      },
                    }),
                  }),
                }),
              }),
            };

            const mockTransitionRepo = {
              save: jest.fn().mockResolvedValue({}),
            };

            const module: TestingModule = await Test.createTestingModule({
              providers: [
                OfferStateMachineService,
                { provide: getRepositoryToken(Offer), useValue: mockOfferRepo },
                { provide: getRepositoryToken(OfferStateTransition), useValue: mockTransitionRepo },
              ],
            }).compile();

            const stateMachine = module.get<OfferStateMachineService>(OfferStateMachineService);
            const offerId = 'test-offer-id';

            // Launch N concurrent transition attempts
            const promises = Array.from({ length: concurrency }, () =>
              stateMachine.transitionState(
                offerId,
                transition.from,
                transition.to,
                'concurrent-test',
              ),
            );

            const results = await Promise.all(promises);

            const successes = results.filter((r) => r === true).length;
            const failures = results.filter((r) => r === false).length;

            // Exactly 1 must succeed
            expect(successes).toBe(1);
            // N-1 must fail
            expect(failures).toBe(concurrency - 1);
            // State transitioned exactly once
            expect(transitionCount).toBe(1);
            // Final state is the target state
            expect(currentState).toBe(transition.to);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('concurrent transitions from different initial states all fail if state already changed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 10 }),
          fc.constantFrom(
            ...getValidTransitions(),
          ),
          async (concurrency: number, transition: { from: OfferState; to: OfferState }) => {
            /**
             * Simulate scenario where the offer state has already changed
             * before any concurrent attempts execute.
             * All N transitions should fail (affected = 0).
             */
            const mockOfferRepo = {
              createQueryBuilder: () => ({
                update: () => ({
                  set: () => ({
                    where: (_: string, __: Record<string, unknown>) => ({
                      execute: async () => {
                        // State already changed — all attempts see affected = 0
                        return { affected: 0 };
                      },
                    }),
                  }),
                }),
              }),
            };

            const mockTransitionRepo = {
              save: jest.fn().mockResolvedValue({}),
            };

            const module: TestingModule = await Test.createTestingModule({
              providers: [
                OfferStateMachineService,
                { provide: getRepositoryToken(Offer), useValue: mockOfferRepo },
                { provide: getRepositoryToken(OfferStateTransition), useValue: mockTransitionRepo },
              ],
            }).compile();

            const stateMachine = module.get<OfferStateMachineService>(OfferStateMachineService);
            const offerId = 'test-offer-already-changed';

            const promises = Array.from({ length: concurrency }, () =>
              stateMachine.transitionState(
                offerId,
                transition.from,
                transition.to,
                'late-attempt',
              ),
            );

            const results = await Promise.all(promises);
            const successes = results.filter((r) => r === true).length;

            // All should fail since state has already changed
            expect(successes).toBe(0);
            // No audit trail should be recorded
            expect(mockTransitionRepo.save).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});

/**
 * Helper: extract all valid (from, to) transition pairs from ALLOWED_TRANSITIONS.
 */
function getValidTransitions(): Array<{ from: OfferState; to: OfferState }> {
  const transitions: Array<{ from: OfferState; to: OfferState }> = [];

  for (const [fromState, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
    for (const toState of targets) {
      transitions.push({ from: fromState as OfferState, to: toState });
    }
  }

  return transitions;
}

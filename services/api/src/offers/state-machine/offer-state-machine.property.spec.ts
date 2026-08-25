import * as fc from 'fast-check';
import { validateTransition } from './offer-state-machine';
import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS } from '../offers.constants';

/**
 * Property-based tests for the offer state machine.
 *
 * Feature: offer-publishing, Property 1: State Machine Transition Validity
 *
 * Validates: Requirements 1.2
 *
 * Generates random (currentState, targetState) pairs from all 7 OfferState values
 * and asserts that validateTransition succeeds if and only if the pair exists in
 * the ALLOWED_TRANSITIONS map.
 */
describe('OfferStateMachine — Property-Based Tests', () => {
  /** All possible offer states */
  const ALL_STATES = Object.values(OfferState);

  /** Arbitrary that picks any OfferState uniformly */
  const offerStateArb = fc.constantFrom(...ALL_STATES);

  describe('Property 1: State Machine Transition Validity', () => {
    it('transition succeeds iff (currentState, targetState) is in ALLOWED_TRANSITIONS', () => {
      fc.assert(
        fc.property(
          offerStateArb,
          offerStateArb,
          (currentState: OfferState, targetState: OfferState) => {
            const result = validateTransition(currentState, targetState);
            const allowedTargets = ALLOWED_TRANSITIONS[currentState];
            const shouldBeValid = allowedTargets.includes(targetState);

            expect(result.valid).toBe(shouldBeValid);

            if (!shouldBeValid) {
              expect(result.reason).toBeDefined();
              expect(result.reason).toContain(currentState);
              expect(result.reason).toContain(targetState);
            } else {
              expect(result.reason).toBeUndefined();
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});

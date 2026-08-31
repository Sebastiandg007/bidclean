/**
 * Offer state machine unit tests.
 * Comprehensive validation of all state transition combinations against the
 * ALLOWED_TRANSITIONS map (the design's source of truth).
 */
import { validateTransition } from '../state-machine/offer-state-machine';
import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS, TERMINAL_STATES } from '../offers.constants';

describe('OfferStateMachine', () => {
  const allStates = Object.values(OfferState);

  describe('allowed transitions', () => {
    it('should allow all valid transitions per design spec', () => {
      for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
        for (const to of targets) {
          const result = validateTransition(from as OfferState, to);
          expect(result.valid).toBe(true);
          expect(result.reason).toBeUndefined();
        }
      }
    });

    it('should reject all invalid transitions', () => {
      for (const from of allStates) {
        const allowed = ALLOWED_TRANSITIONS[from];
        for (const to of allStates) {
          if (allowed.includes(to)) {
            continue;
          }
          const result = validateTransition(from, to);
          expect(result.valid).toBe(false);
          expect(result.reason).toContain('not allowed');
        }
      }
    });

    it('should reject transitions from terminal states', () => {
      for (const terminal of TERMINAL_STATES) {
        expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
        for (const to of allStates) {
          expect(validateTransition(terminal, to).valid).toBe(false);
        }
      }
    });

    it('should reject self-transitions', () => {
      for (const state of allStates) {
        // No state lists itself as a valid target.
        expect(ALLOWED_TRANSITIONS[state]).not.toContain(state);
        expect(validateTransition(state, state).valid).toBe(false);
      }
    });
  });

  describe('specific lifecycle edges', () => {
    it('allows DRAFT -> PUBLISHED and DRAFT -> CANCELLED', () => {
      expect(validateTransition(OfferState.DRAFT, OfferState.PUBLISHED).valid).toBe(true);
      expect(validateTransition(OfferState.DRAFT, OfferState.CANCELLED).valid).toBe(true);
    });

    it('allows ACTIVE -> MATCHED (the payment trigger)', () => {
      expect(validateTransition(OfferState.ACTIVE, OfferState.MATCHED).valid).toBe(true);
    });

    it('allows MATCHED -> COMPLETED only', () => {
      expect(validateTransition(OfferState.MATCHED, OfferState.COMPLETED).valid).toBe(true);
      expect(validateTransition(OfferState.MATCHED, OfferState.CANCELLED).valid).toBe(false);
    });

    it('rejects skipping states (DRAFT -> ACTIVE)', () => {
      expect(validateTransition(OfferState.DRAFT, OfferState.ACTIVE).valid).toBe(false);
    });
  });
});

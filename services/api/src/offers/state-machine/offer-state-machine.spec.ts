import { validateTransition } from './offer-state-machine';
import { OfferState } from '../offers.types';

/**
 * Offer state machine unit tests.
 * Validates transition rules match the design spec.
 */
describe('OfferStateMachine', () => {
  describe('validateTransition', () => {
    it('should allow DRAFT → PUBLISHED', () => {
      const result = validateTransition(OfferState.DRAFT, OfferState.PUBLISHED);
      expect(result.valid).toBe(true);
    });

    it('should allow DRAFT → CANCELLED', () => {
      const result = validateTransition(OfferState.DRAFT, OfferState.CANCELLED);
      expect(result.valid).toBe(true);
    });

    it('should reject DRAFT → ACTIVE', () => {
      const result = validateTransition(OfferState.DRAFT, OfferState.ACTIVE);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should reject transitions from terminal states', () => {
      const terminalStates = [OfferState.COMPLETED, OfferState.CANCELLED, OfferState.EXPIRED];
      for (const state of terminalStates) {
        const result = validateTransition(state, OfferState.DRAFT);
        expect(result.valid).toBe(false);
      }
    });
  });
});

import { KycStateMachine } from '../state-machine/kyc-state-machine';
import { KycStatus } from '../kyc.types';

describe('KycStateMachine', () => {
  describe('isValidTransition', () => {
    it('should allow NOT_STARTED → DOCUMENT_UPLOADED', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.NOT_STARTED, KycStatus.DOCUMENT_UPLOADED),
      ).toBe(true);
    });

    it('should allow DOCUMENT_UPLOADED → SELFIE_UPLOADED', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.DOCUMENT_UPLOADED, KycStatus.SELFIE_UPLOADED),
      ).toBe(true);
    });

    it('should allow SELFIE_UPLOADED → PROCESSING', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.SELFIE_UPLOADED, KycStatus.PROCESSING),
      ).toBe(true);
    });

    it('should allow PROCESSING → VERIFIED', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.PROCESSING, KycStatus.VERIFIED),
      ).toBe(true);
    });

    it('should allow PROCESSING → REJECTED', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.PROCESSING, KycStatus.REJECTED),
      ).toBe(true);
    });

    it('should reject skipping states (NOT_STARTED → PROCESSING)', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.NOT_STARTED, KycStatus.PROCESSING),
      ).toBe(false);
    });

    it('should reject backwards transitions (PROCESSING → NOT_STARTED)', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.PROCESSING, KycStatus.NOT_STARTED),
      ).toBe(false);
    });

    it('should reject transitions from terminal state VERIFIED', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.VERIFIED, KycStatus.NOT_STARTED),
      ).toBe(false);
    });

    it('should reject transitions from terminal state REJECTED', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.REJECTED, KycStatus.NOT_STARTED),
      ).toBe(false);
    });
  });

  describe('transition', () => {
    it('should return the target status on valid transition', () => {
      const result = KycStateMachine.transition(KycStatus.NOT_STARTED, KycStatus.DOCUMENT_UPLOADED);
      expect(result).toBe(KycStatus.DOCUMENT_UPLOADED);
    });

    it('should throw on invalid transition', () => {
      expect(() =>
        KycStateMachine.transition(KycStatus.NOT_STARTED, KycStatus.VERIFIED),
      ).toThrow('Invalid KYC state transition');
    });
  });

  describe('isTerminal', () => {
    it('should return true for VERIFIED', () => {
      expect(KycStateMachine.isTerminal(KycStatus.VERIFIED)).toBe(true);
    });

    it('should return true for REJECTED', () => {
      expect(KycStateMachine.isTerminal(KycStatus.REJECTED)).toBe(true);
    });

    it('should return false for PROCESSING', () => {
      expect(KycStateMachine.isTerminal(KycStatus.PROCESSING)).toBe(false);
    });

    it('should return false for NOT_STARTED', () => {
      expect(KycStateMachine.isTerminal(KycStatus.NOT_STARTED)).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('should return [DOCUMENT_UPLOADED] for NOT_STARTED', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.NOT_STARTED)).toEqual([
        KycStatus.DOCUMENT_UPLOADED,
      ]);
    });

    it('should return [VERIFIED, REJECTED] for PROCESSING', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.PROCESSING)).toEqual([
        KycStatus.VERIFIED,
        KycStatus.REJECTED,
      ]);
    });

    it('should return empty array for VERIFIED', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.VERIFIED)).toEqual([]);
    });
  });
});

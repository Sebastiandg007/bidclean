import { KycStateMachine } from '../state-machine/kyc-state-machine';
import { KycStatus } from '../kyc.types';
import { KycVerification } from '../entities/kyc-verification.entity';
import { InvalidStateTransitionError } from '../state-machine/kyc-state-machine.errors';
import { TransitionContext } from '../state-machine/kyc-state-machine.types';

/**
 * Helper to create a minimal verification entity for testing.
 */
function createVerification(overrides: Partial<KycVerification> = {}): KycVerification {
  const verification = new KycVerification();
  verification.id = 'test-verification-id';
  verification.userId = 'test-user-id';
  verification.status = KycStatus.NOT_STARTED;
  verification.attemptNumber = 1;
  verification.documentType = null;
  verification.documentStorageKey = null;
  verification.selfieStorageKey = null;
  verification.extractedName = null;
  verification.extractedDocumentNumber = null;
  verification.extractedExpiryDate = null;
  verification.extractedDocumentType = null;
  verification.ocrConfidence = null;
  verification.faceSimilarityScore = null;
  verification.livenessScore = null;
  verification.nameMatchScore = null;
  verification.processingAttempts = 0;
  verification.lastProcessingError = null;
  verification.rejectionReason = null;
  verification.reviewedBy = null;
  verification.reviewedAt = null;
  verification.documentUploadedAt = null;
  verification.selfieUploadedAt = null;
  verification.processingStartedAt = null;
  verification.completedAt = null;
  verification.expiresAt = null;
  verification.createdAt = new Date();
  verification.updatedAt = new Date();
  Object.assign(verification, overrides);
  return verification;
}

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

    it('should reject NOT_STARTED → VERIFIED (skipping entire flow)', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.NOT_STARTED, KycStatus.VERIFIED),
      ).toBe(false);
    });

    it('should reject DOCUMENT_UPLOADED → PROCESSING (skipping selfie)', () => {
      expect(
        KycStateMachine.isValidTransition(KycStatus.DOCUMENT_UPLOADED, KycStatus.PROCESSING),
      ).toBe(false);
    });
  });

  describe('transition', () => {
    it('should return the target status on valid transition', () => {
      const result = KycStateMachine.transition(KycStatus.NOT_STARTED, KycStatus.DOCUMENT_UPLOADED);
      expect(result).toBe(KycStatus.DOCUMENT_UPLOADED);
    });

    it('should throw InvalidStateTransitionError on invalid transition', () => {
      expect(() =>
        KycStateMachine.transition(KycStatus.NOT_STARTED, KycStatus.VERIFIED),
      ).toThrow(InvalidStateTransitionError);
    });

    it('should include from/to status in error', () => {
      try {
        KycStateMachine.transition(KycStatus.NOT_STARTED, KycStatus.VERIFIED);
        fail('Expected to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidStateTransitionError);
        const response = (error as InvalidStateTransitionError).getResponse() as Record<string, unknown>;
        expect(response.from).toBe(KycStatus.NOT_STARTED);
        expect(response.to).toBe(KycStatus.VERIFIED);
      }
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

    it('should return false for DOCUMENT_UPLOADED', () => {
      expect(KycStateMachine.isTerminal(KycStatus.DOCUMENT_UPLOADED)).toBe(false);
    });

    it('should return false for SELFIE_UPLOADED', () => {
      expect(KycStateMachine.isTerminal(KycStatus.SELFIE_UPLOADED)).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('should return [DOCUMENT_UPLOADED] for NOT_STARTED', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.NOT_STARTED)).toEqual([
        KycStatus.DOCUMENT_UPLOADED,
      ]);
    });

    it('should return [SELFIE_UPLOADED] for DOCUMENT_UPLOADED', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.DOCUMENT_UPLOADED)).toEqual([
        KycStatus.SELFIE_UPLOADED,
      ]);
    });

    it('should return [PROCESSING] for SELFIE_UPLOADED', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.SELFIE_UPLOADED)).toEqual([
        KycStatus.PROCESSING,
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

    it('should return empty array for REJECTED', () => {
      expect(KycStateMachine.getValidTransitions(KycStatus.REJECTED)).toEqual([]);
    });
  });

  describe('isIdempotent', () => {
    it('should return true when current equals target', () => {
      expect(KycStateMachine.isIdempotent(KycStatus.DOCUMENT_UPLOADED, KycStatus.DOCUMENT_UPLOADED)).toBe(true);
    });

    it('should return false when current differs from target', () => {
      expect(KycStateMachine.isIdempotent(KycStatus.NOT_STARTED, KycStatus.DOCUMENT_UPLOADED)).toBe(false);
    });

    it('should return true for terminal states', () => {
      expect(KycStateMachine.isIdempotent(KycStatus.VERIFIED, KycStatus.VERIFIED)).toBe(true);
    });
  });

  describe('evaluateGuards', () => {
    describe('DOCUMENT_UPLOADED guards', () => {
      it('should pass when documentStorageKey is provided', () => {
        const context: TransitionContext = {
          verification: createVerification(),
          documentStorageKey: 'kyc/user-123/doc-abc.jpg',
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.DOCUMENT_UPLOADED, context);
        expect(result).toBeNull();
      });

      it('should fail when documentStorageKey is missing', () => {
        const context: TransitionContext = {
          verification: createVerification(),
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.DOCUMENT_UPLOADED, context);
        expect(result).not.toBeNull();
        expect(result!.guardName).toBe('documentStorageKeyRequired');
      });
    });

    describe('SELFIE_UPLOADED guards', () => {
      it('should pass when selfieStorageKey is provided and document exists', () => {
        const context: TransitionContext = {
          verification: createVerification({
            status: KycStatus.DOCUMENT_UPLOADED,
            documentStorageKey: 'kyc/user-123/doc-abc.jpg',
          }),
          selfieStorageKey: 'kyc/user-123/selfie-xyz.jpg',
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.SELFIE_UPLOADED, context);
        expect(result).toBeNull();
      });

      it('should fail when selfieStorageKey is missing', () => {
        const context: TransitionContext = {
          verification: createVerification({
            status: KycStatus.DOCUMENT_UPLOADED,
            documentStorageKey: 'kyc/user-123/doc-abc.jpg',
          }),
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.SELFIE_UPLOADED, context);
        expect(result).not.toBeNull();
        expect(result!.guardName).toBe('selfieStorageKeyRequired');
      });

      it('should fail when document does not exist on verification', () => {
        const context: TransitionContext = {
          verification: createVerification({
            status: KycStatus.DOCUMENT_UPLOADED,
            documentStorageKey: null,
          }),
          selfieStorageKey: 'kyc/user-123/selfie-xyz.jpg',
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.SELFIE_UPLOADED, context);
        expect(result).not.toBeNull();
        expect(result!.guardName).toBe('documentMustExist');
      });
    });

    describe('PROCESSING guards', () => {
      it('should pass when selfie exists on verification', () => {
        const context: TransitionContext = {
          verification: createVerification({
            status: KycStatus.SELFIE_UPLOADED,
            documentStorageKey: 'kyc/user-123/doc-abc.jpg',
            selfieStorageKey: 'kyc/user-123/selfie-xyz.jpg',
          }),
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.PROCESSING, context);
        expect(result).toBeNull();
      });

      it('should fail when selfie does not exist on verification', () => {
        const context: TransitionContext = {
          verification: createVerification({
            status: KycStatus.SELFIE_UPLOADED,
            selfieStorageKey: null,
          }),
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.PROCESSING, context);
        expect(result).not.toBeNull();
        expect(result!.guardName).toBe('selfieMustExist');
      });
    });

    describe('REJECTED guards', () => {
      it('should pass when rejectionReason is provided', () => {
        const context: TransitionContext = {
          verification: createVerification({ status: KycStatus.PROCESSING }),
          rejectionReason: 'Face similarity below threshold',
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.REJECTED, context);
        expect(result).toBeNull();
      });

      it('should fail when rejectionReason is missing', () => {
        const context: TransitionContext = {
          verification: createVerification({ status: KycStatus.PROCESSING }),
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.REJECTED, context);
        expect(result).not.toBeNull();
        expect(result!.guardName).toBe('rejectionReasonRequired');
      });
    });

    describe('VERIFIED guards', () => {
      it('should pass with no special requirements', () => {
        const context: TransitionContext = {
          verification: createVerification({ status: KycStatus.PROCESSING }),
        };

        const result = KycStateMachine.evaluateGuards(KycStatus.VERIFIED, context);
        expect(result).toBeNull();
      });
    });
  });

  describe('getTransitionMetadata', () => {
    const now = new Date('2024-01-15T10:00:00Z');

    it('should set documentUploadedAt for DOCUMENT_UPLOADED', () => {
      const context: TransitionContext = {
        verification: createVerification(),
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.DOCUMENT_UPLOADED,
        context,
        now,
      );

      expect(metadata.documentUploadedAt).toEqual(now);
    });

    it('should set selfieUploadedAt for SELFIE_UPLOADED', () => {
      const context: TransitionContext = {
        verification: createVerification(),
        selfieStorageKey: 'kyc/user/selfie.jpg',
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.SELFIE_UPLOADED,
        context,
        now,
      );

      expect(metadata.selfieUploadedAt).toEqual(now);
    });

    it('should set processingStartedAt for PROCESSING', () => {
      const context: TransitionContext = {
        verification: createVerification(),
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.PROCESSING,
        context,
        now,
      );

      expect(metadata.processingStartedAt).toEqual(now);
    });

    it('should set completedAt for VERIFIED', () => {
      const context: TransitionContext = {
        verification: createVerification(),
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.VERIFIED,
        context,
        now,
      );

      expect(metadata.completedAt).toEqual(now);
    });

    it('should set completedAt and rejectionReason for REJECTED', () => {
      const context: TransitionContext = {
        verification: createVerification(),
        rejectionReason: 'Face mismatch',
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.REJECTED,
        context,
        now,
      );

      expect(metadata.completedAt).toEqual(now);
      expect(metadata.rejectionReason).toBe('Face mismatch');
    });

    it('should set reviewedBy and reviewedAt when admin approves', () => {
      const context: TransitionContext = {
        verification: createVerification(),
        reviewedBy: 'admin-user-id',
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.VERIFIED,
        context,
        now,
      );

      expect(metadata.reviewedBy).toBe('admin-user-id');
      expect(metadata.reviewedAt).toEqual(now);
    });

    it('should not set reviewedAt when no reviewer', () => {
      const context: TransitionContext = {
        verification: createVerification(),
      };

      const metadata = KycStateMachine.getTransitionMetadata(
        KycStatus.VERIFIED,
        context,
        now,
      );

      expect(metadata.reviewedBy).toBeNull();
      expect(metadata.reviewedAt).toBeNull();
    });
  });

  describe('getGuards', () => {
    it('should return guards for DOCUMENT_UPLOADED', () => {
      const guards = KycStateMachine.getGuards(KycStatus.DOCUMENT_UPLOADED);
      expect(guards).toHaveLength(1);
      expect(guards[0]!.name).toBe('documentStorageKeyRequired');
    });

    it('should return guards for SELFIE_UPLOADED', () => {
      const guards = KycStateMachine.getGuards(KycStatus.SELFIE_UPLOADED);
      expect(guards).toHaveLength(2);
    });

    it('should return empty guards for NOT_STARTED', () => {
      const guards = KycStateMachine.getGuards(KycStatus.NOT_STARTED);
      expect(guards).toHaveLength(0);
    });
  });
});

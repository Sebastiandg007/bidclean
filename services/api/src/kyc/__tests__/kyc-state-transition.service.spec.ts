import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycStatus } from '../kyc.types';
import {
  InvalidStateTransitionError,
  StateConflictError,
  TransitionGuardError,
} from '../state-machine/kyc-state-machine.errors';
import { TransitionContext } from '../state-machine/kyc-state-machine.types';

/**
 * Helper to create a verification entity for testing.
 */
function createVerification(overrides: Partial<KycVerification> = {}): KycVerification {
  const verification = new KycVerification();
  verification.id = 'verification-uuid-1';
  verification.userId = 'user-uuid-1';
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

/**
 * Mock query builder that simulates TypeORM chain pattern.
 */
function createMockQueryBuilder(returnValue: KycVerification | null, affected = 1) {
  const qb = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(returnValue),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  return qb;
}

describe('KycStateTransitionService', () => {
  let service: KycStateTransitionService;
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockManager: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder(null);

    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const mockRepository = {
      manager: {
        transaction: jest.fn().mockImplementation(
          async (cb: (manager: typeof mockManager) => Promise<unknown>) => cb(mockManager),
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycStateTransitionService,
        {
          provide: getRepositoryToken(KycVerification),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<KycStateTransitionService>(KycStateTransitionService);
  });

  describe('transition - valid transitions', () => {
    it('should transition NOT_STARTED → DOCUMENT_UPLOADED', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user-uuid-1/doc-abc.jpg',
      };

      const result = await service.transition({
        targetStatus: KycStatus.DOCUMENT_UPLOADED,
        context,
      });

      expect(result.previousStatus).toBe(KycStatus.NOT_STARTED);
      expect(result.newStatus).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(result.wasIdempotent).toBe(false);
      expect(result.verificationId).toBe(verification.id);
    });

    it('should transition DOCUMENT_UPLOADED → SELFIE_UPLOADED', async () => {
      const verification = createVerification({
        status: KycStatus.DOCUMENT_UPLOADED,
        documentStorageKey: 'kyc/user/doc.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        selfieStorageKey: 'kyc/user-uuid-1/selfie-xyz.jpg',
      };

      const result = await service.transition({
        targetStatus: KycStatus.SELFIE_UPLOADED,
        context,
      });

      expect(result.previousStatus).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(result.newStatus).toBe(KycStatus.SELFIE_UPLOADED);
      expect(result.wasIdempotent).toBe(false);
    });

    it('should transition SELFIE_UPLOADED → PROCESSING', async () => {
      const verification = createVerification({
        status: KycStatus.SELFIE_UPLOADED,
        documentStorageKey: 'kyc/user/doc.jpg',
        selfieStorageKey: 'kyc/user/selfie.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      const result = await service.transition({
        targetStatus: KycStatus.PROCESSING,
        context,
      });

      expect(result.previousStatus).toBe(KycStatus.SELFIE_UPLOADED);
      expect(result.newStatus).toBe(KycStatus.PROCESSING);
    });

    it('should transition PROCESSING → VERIFIED', async () => {
      const verification = createVerification({
        status: KycStatus.PROCESSING,
        documentStorageKey: 'kyc/user/doc.jpg',
        selfieStorageKey: 'kyc/user/selfie.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      const result = await service.transition({
        targetStatus: KycStatus.VERIFIED,
        context,
      });

      expect(result.newStatus).toBe(KycStatus.VERIFIED);
    });

    it('should transition PROCESSING → REJECTED with reason', async () => {
      const verification = createVerification({
        status: KycStatus.PROCESSING,
        documentStorageKey: 'kyc/user/doc.jpg',
        selfieStorageKey: 'kyc/user/selfie.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        rejectionReason: 'Face similarity score below threshold',
      };

      const result = await service.transition({
        targetStatus: KycStatus.REJECTED,
        context,
      });

      expect(result.newStatus).toBe(KycStatus.REJECTED);
    });
  });

  describe('transition - idempotency', () => {
    it('should return idempotent result when already in target state', async () => {
      const verification = createVerification({ status: KycStatus.DOCUMENT_UPLOADED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      const result = await service.transition({
        targetStatus: KycStatus.DOCUMENT_UPLOADED,
        context,
      });

      expect(result.wasIdempotent).toBe(true);
      expect(result.previousStatus).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(result.newStatus).toBe(KycStatus.DOCUMENT_UPLOADED);
    });

    it('should not call update query on idempotent transition', async () => {
      const verification = createVerification({ status: KycStatus.VERIFIED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await service.transition({
        targetStatus: KycStatus.VERIFIED,
        context,
      });

      expect(mockQueryBuilder.execute).not.toHaveBeenCalled();
    });
  });

  describe('transition - invalid transitions', () => {
    it('should throw InvalidStateTransitionError for skipping states', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await expect(
        service.transition({
          targetStatus: KycStatus.PROCESSING,
          context,
        }),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it('should throw InvalidStateTransitionError from terminal state', async () => {
      const verification = createVerification({ status: KycStatus.VERIFIED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await expect(
        service.transition({
          targetStatus: KycStatus.NOT_STARTED,
          context,
        }),
      ).rejects.toThrow(InvalidStateTransitionError);
    });
  });

  describe('transition - guard failures', () => {
    it('should throw TransitionGuardError when document key is missing', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await expect(
        service.transition({
          targetStatus: KycStatus.DOCUMENT_UPLOADED,
          context,
        }),
      ).rejects.toThrow(TransitionGuardError);
    });

    it('should throw TransitionGuardError when selfie key is missing', async () => {
      const verification = createVerification({
        status: KycStatus.DOCUMENT_UPLOADED,
        documentStorageKey: 'kyc/user/doc.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await expect(
        service.transition({
          targetStatus: KycStatus.SELFIE_UPLOADED,
          context,
        }),
      ).rejects.toThrow(TransitionGuardError);
    });

    it('should throw TransitionGuardError when rejection reason is missing', async () => {
      const verification = createVerification({ status: KycStatus.PROCESSING });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await expect(
        service.transition({
          targetStatus: KycStatus.REJECTED,
          context,
        }),
      ).rejects.toThrow(TransitionGuardError);
    });
  });

  describe('transition - conflict detection', () => {
    it('should throw StateConflictError when verification not found', async () => {
      const verification = createVerification();
      mockQueryBuilder.getOne.mockResolvedValue(null);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      await expect(
        service.transition({
          targetStatus: KycStatus.DOCUMENT_UPLOADED,
          context,
        }),
      ).rejects.toThrow(StateConflictError);
    });

    it('should throw StateConflictError when concurrent update detected', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);
      mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      await expect(
        service.transition({
          targetStatus: KycStatus.DOCUMENT_UPLOADED,
          context,
        }),
      ).rejects.toThrow(StateConflictError);
    });
  });

  describe('transition - metadata recording', () => {
    it('should include documentUploadedAt in update for DOCUMENT_UPLOADED', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      await service.transition({
        targetStatus: KycStatus.DOCUMENT_UPLOADED,
        context,
      });

      const setCall = mockQueryBuilder.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.status).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(setCall.documentUploadedAt).toBeInstanceOf(Date);
    });

    it('should include selfieUploadedAt in update for SELFIE_UPLOADED', async () => {
      const verification = createVerification({
        status: KycStatus.DOCUMENT_UPLOADED,
        documentStorageKey: 'kyc/user/doc.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        selfieStorageKey: 'kyc/user/selfie.jpg',
      };

      await service.transition({
        targetStatus: KycStatus.SELFIE_UPLOADED,
        context,
      });

      const setCall = mockQueryBuilder.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.status).toBe(KycStatus.SELFIE_UPLOADED);
      expect(setCall.selfieUploadedAt).toBeInstanceOf(Date);
    });

    it('should include completedAt in update for VERIFIED', async () => {
      const verification = createVerification({
        status: KycStatus.PROCESSING,
        selfieStorageKey: 'kyc/user/selfie.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = { verification };

      await service.transition({
        targetStatus: KycStatus.VERIFIED,
        context,
      });

      const setCall = mockQueryBuilder.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.status).toBe(KycStatus.VERIFIED);
      expect(setCall.completedAt).toBeInstanceOf(Date);
    });

    it('should include rejectionReason in update for REJECTED', async () => {
      const verification = createVerification({
        status: KycStatus.PROCESSING,
        selfieStorageKey: 'kyc/user/selfie.jpg',
      });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        rejectionReason: 'Document expired',
      };

      await service.transition({
        targetStatus: KycStatus.REJECTED,
        context,
      });

      const setCall = mockQueryBuilder.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.rejectionReason).toBe('Document expired');
      expect(setCall.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('transition - atomic update pattern', () => {
    it('should use WHERE status = :expectedStatus in update', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      await service.transition({
        targetStatus: KycStatus.DOCUMENT_UPLOADED,
        context,
      });

      const whereCall = mockQueryBuilder.where.mock.calls[1];
      expect(whereCall[0]).toContain('status = :expectedStatus');
      expect(whereCall[1]).toEqual({
        id: verification.id,
        expectedStatus: KycStatus.NOT_STARTED,
      });
    });

    it('should use pessimistic_write lock when acquiring verification', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      await service.transition({
        targetStatus: KycStatus.DOCUMENT_UPLOADED,
        context,
      });

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    });
  });

  describe('transitionWithManager', () => {
    it('should use the provided manager instead of creating a new transaction', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });
      mockQueryBuilder.getOne.mockResolvedValue(verification);

      const context: TransitionContext = {
        verification,
        documentStorageKey: 'kyc/user/doc.jpg',
      };

      const result = await service.transitionWithManager(
        mockManager as unknown as EntityManager,
        {
          targetStatus: KycStatus.DOCUMENT_UPLOADED,
          context,
        },
      );

      expect(result.newStatus).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(result.wasIdempotent).toBe(false);
    });
  });
});

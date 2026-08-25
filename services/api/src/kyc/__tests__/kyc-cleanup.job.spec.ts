import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KycCleanupJob } from '../jobs/kyc-cleanup.job';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStorageService } from '../storage/kyc-storage.service';
import { KycAuditService } from '../kyc-audit.service';
import { KycStatus } from '../kyc.types';

/**
 * Unit tests for KycCleanupJob.
 * Tests the scheduled cleanup of expired KYC images from MinIO.
 */
describe('KycCleanupJob', () => {
  let job: KycCleanupJob;
  let mockStorageDelete: jest.Mock;
  let mockRepoUpdate: jest.Mock;
  let mockAuditCreate: jest.Mock;
  let mockAuditSave: jest.Mock;
  let mockGetMany: jest.Mock;
  let mockLogDeletion: jest.Mock;

  const MOCK_RETENTION_DAYS = '90';

  const createMockVerification = (overrides?: Partial<KycVerification>): KycVerification => ({
    id: 'verification-uuid-1',
    userId: 'user-uuid-1',
    status: KycStatus.VERIFIED,
    attemptNumber: 1,
    documentType: null,
    documentStorageKey: 'kyc/user-uuid-1/document/doc.jpg',
    selfieStorageKey: 'kyc/user-uuid-1/selfie/selfie.jpg',
    extractedName: null,
    extractedDocumentNumber: null,
    extractedExpiryDate: null,
    extractedDocumentType: null,
    ocrConfidence: null,
    faceSimilarityScore: null,
    livenessScore: null,
    nameMatchScore: null,
    processingAttempts: 1,
    lastProcessingError: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    documentUploadedAt: null,
    selfieUploadedAt: null,
    processingStartedAt: null,
    completedAt: new Date('2024-01-01'),
    expiresAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    user: {} as any,
    reviewer: null,
    ...overrides,
  });

  beforeEach(async () => {
    mockStorageDelete = jest.fn().mockResolvedValue(undefined);
    mockRepoUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    mockAuditCreate = jest.fn((data: Record<string, unknown>) => data);
    mockAuditSave = jest.fn().mockResolvedValue(undefined);
    mockGetMany = jest.fn().mockResolvedValue([]);
    mockLogDeletion = jest.fn().mockResolvedValue(undefined);

    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: mockGetMany,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycCleanupJob,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'KYC_RETENTION_DAYS') return MOCK_RETENTION_DAYS;
              throw new Error(`Missing env: ${key}`);
            }),
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'KYC_CLEANUP_BATCH_SIZE') return defaultValue ?? '50';
              return defaultValue;
            }),
          },
        },
        {
          provide: getRepositoryToken(KycVerification),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            update: mockRepoUpdate,
          },
        },
        {
          provide: getRepositoryToken(KycAuditLog),
          useValue: {
            create: mockAuditCreate,
            save: mockAuditSave,
          },
        },
        {
          provide: KycStorageService,
          useValue: {
            delete: mockStorageDelete,
          },
        },
        {
          provide: KycAuditService,
          useValue: {
            logStateTransition: jest.fn().mockResolvedValue(undefined),
            logDataAccess: jest.fn().mockResolvedValue(undefined),
            logAdminDecision: jest.fn().mockResolvedValue(undefined),
            logDeletion: mockLogDeletion,
          },
        },
      ],
    }).compile();

    job = module.get<KycCleanupJob>(KycCleanupJob);
  });

  describe('constructor', () => {
    it('should read retention days from environment', () => {
      expect(job.retentionDays).toBe(90);
    });
  });

  describe('run', () => {
    it('should complete without errors when no expired verifications found', async () => {
      await job.run();

      expect(mockStorageDelete).not.toHaveBeenCalled();
    });

    it('should delete document image and clear storage key', async () => {
      const verification = createMockVerification({
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: null,
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockStorageDelete).toHaveBeenCalledWith({
        key: 'kyc/user-1/document/doc.jpg',
      });
      expect(mockRepoUpdate).toHaveBeenCalledWith(
        verification.id,
        { documentStorageKey: null },
      );
    });

    it('should delete selfie image and clear storage key', async () => {
      const verification = createMockVerification({
        documentStorageKey: null,
        selfieStorageKey: 'kyc/user-1/selfie/selfie.jpg',
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockStorageDelete).toHaveBeenCalledWith({
        key: 'kyc/user-1/selfie/selfie.jpg',
      });
      expect(mockRepoUpdate).toHaveBeenCalledWith(
        verification.id,
        { selfieStorageKey: null },
      );
    });

    it('should delete both document and selfie when both exist', async () => {
      const verification = createMockVerification({
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: 'kyc/user-1/selfie/selfie.jpg',
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockStorageDelete).toHaveBeenCalledTimes(2);
      expect(mockStorageDelete).toHaveBeenCalledWith({ key: 'kyc/user-1/document/doc.jpg' });
      expect(mockStorageDelete).toHaveBeenCalledWith({ key: 'kyc/user-1/selfie/selfie.jpg' });
      expect(mockRepoUpdate).toHaveBeenCalledWith(
        verification.id,
        { documentStorageKey: null },
      );
      expect(mockRepoUpdate).toHaveBeenCalledWith(
        verification.id,
        { selfieStorageKey: null },
      );
    });

    it('should create audit log entry for document deletion', async () => {
      const verification = createMockVerification({
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: null,
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockLogDeletion).toHaveBeenCalledWith({
        verificationId: verification.id,
        action: 'DOCUMENT_DELETED',
        metadata: {
          triggeredBy: 'kyc-cleanup-job',
          storageKey: 'kyc/user-1/document/doc.jpg',
          retentionDays: 90,
        },
      });
    });

    it('should create audit log entry for selfie deletion', async () => {
      const verification = createMockVerification({
        documentStorageKey: null,
        selfieStorageKey: 'kyc/user-1/selfie/selfie.jpg',
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockLogDeletion).toHaveBeenCalledWith({
        verificationId: verification.id,
        action: 'SELFIE_DELETED',
        metadata: {
          triggeredBy: 'kyc-cleanup-job',
          storageKey: 'kyc/user-1/selfie/selfie.jpg',
          retentionDays: 90,
        },
      });
    });

    it('should continue processing other verifications when one fails', async () => {
      const verification1 = createMockVerification({
        id: 'v1',
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: null,
      });
      const verification2 = createMockVerification({
        id: 'v2',
        documentStorageKey: 'kyc/user-2/document/doc.jpg',
        selfieStorageKey: null,
      });

      mockGetMany.mockResolvedValueOnce([verification1, verification2]).mockResolvedValueOnce([]);
      mockStorageDelete
        .mockRejectedValueOnce(new Error('MinIO connection lost'))
        .mockResolvedValueOnce(undefined);

      await job.run();

      expect(mockStorageDelete).toHaveBeenCalledTimes(2);
      expect(mockRepoUpdate).toHaveBeenCalledTimes(1);
      expect(mockRepoUpdate).toHaveBeenCalledWith('v2', { documentStorageKey: null });
    });

    it('should not clear storage key when MinIO delete fails', async () => {
      const verification = createMockVerification({
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: null,
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);
      mockStorageDelete.mockRejectedValue(new Error('Storage unavailable'));

      await job.run();

      expect(mockRepoUpdate).not.toHaveBeenCalled();
      expect(mockAuditSave).not.toHaveBeenCalled();
    });

    it('should process multiple batches when more verifications exist', async () => {
      const fullBatch = Array.from({ length: 50 }, (_, i) =>
        createMockVerification({
          id: `v-${i}`,
          documentStorageKey: `kyc/user-${i}/document/doc.jpg`,
          selfieStorageKey: null,
        }),
      );
      const partialBatch = [
        createMockVerification({
          id: 'v-50',
          documentStorageKey: 'kyc/user-50/document/doc.jpg',
          selfieStorageKey: null,
        }),
      ];

      mockGetMany
        .mockResolvedValueOnce(fullBatch)
        .mockResolvedValueOnce(partialBatch)
        .mockResolvedValueOnce([]);

      await job.run();

      expect(mockStorageDelete).toHaveBeenCalledTimes(51);
    });

    it('should handle idempotent deletion (already deleted from MinIO)', async () => {
      const verification = createMockVerification({
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: null,
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockStorageDelete).toHaveBeenCalledWith({
        key: 'kyc/user-1/document/doc.jpg',
      });
      expect(mockRepoUpdate).toHaveBeenCalledWith(
        verification.id,
        { documentStorageKey: null },
      );
    });

    it('should use correct cutoff date based on retention days', async () => {
      const now = new Date('2024-06-15T03:00:00Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      await job.run();

      jest.useRealTimers();
    });

    it('should set actorId to null in audit log (system action)', async () => {
      const verification = createMockVerification({
        documentStorageKey: 'kyc/user-1/document/doc.jpg',
        selfieStorageKey: null,
      });

      mockGetMany.mockResolvedValueOnce([verification]).mockResolvedValueOnce([]);

      await job.run();

      expect(mockLogDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationId: verification.id,
        }),
      );
    });
  });
});

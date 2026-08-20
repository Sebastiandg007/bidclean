import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { KycProcessJob } from '../jobs/kyc-process.job';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { User } from '../../auth/entities/user.entity';
import { KycStatus } from '../kyc.types';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { KycNotificationService } from '../kyc-notification.service';
import { KycAuditService } from '../kyc-audit.service';
import {
  AiServiceHttpError,
  AiServiceNetworkError,
  AiServiceTimeoutError,
} from '../ai-client/ai-client.errors';

/**
 * Unit tests for KycProcessJob.
 * Tests the BullMQ processing pipeline: OCR → liveness → face compare → evaluate.
 */
describe('KycProcessJob', () => {
  let job: KycProcessJob;

  // Mock config mirrors environment variable values
  const MOCK_MAX_RETRIES = '3';
  const MOCK_BACKOFF_MS = '5000';
  const MOCK_OCR_THRESHOLD = '0.85';
  const MOCK_FACE_THRESHOLD = '0.80';
  const MOCK_LIVENESS_THRESHOLD = '0.90';

  const mockKycRepository = {
    findOneOrFail: jest.fn(),
    update: jest.fn(),
  };

  const mockAuditLogRepository = {
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn(),
  };

  const mockUserRepository = {
    findOneOrFail: jest.fn(),
  };

  const mockStateTransitionService = {
    transition: jest.fn(),
  };

  const mockAiClientService = {
    extractDocument: jest.fn(),
    detectLiveness: jest.fn(),
    compareFaces: jest.fn(),
  };

  const mockKycAuditService = {
    logStateTransition: jest.fn().mockResolvedValue(undefined),
    logDataAccess: jest.fn().mockResolvedValue(undefined),
    logAdminDecision: jest.fn().mockResolvedValue(undefined),
    logDeletion: jest.fn().mockResolvedValue(undefined),
  };

  const mockKycNotificationService = {
    notifyStatusChange: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigValues: Record<string, string | undefined> = {
    KYC_PROCESSING_MAX_RETRIES: MOCK_MAX_RETRIES,
    KYC_PROCESSING_BACKOFF_MS: MOCK_BACKOFF_MS,
    KYC_OCR_CONFIDENCE_THRESHOLD: MOCK_OCR_THRESHOLD,
    KYC_FACE_SIMILARITY_THRESHOLD: MOCK_FACE_THRESHOLD,
    KYC_LIVENESS_THRESHOLD: MOCK_LIVENESS_THRESHOLD,
    ONESIGNAL_APP_ID: undefined,
    ONESIGNAL_API_KEY: undefined,
  };

  const createMockVerification = (overrides?: Partial<KycVerification>): KycVerification => ({
    id: 'verification-uuid-1',
    userId: 'user-uuid-1',
    status: KycStatus.SELFIE_UPLOADED,
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
    processingAttempts: 0,
    lastProcessingError: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    documentUploadedAt: null,
    selfieUploadedAt: null,
    processingStartedAt: null,
    completedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as User,
    reviewer: null,
    ...overrides,
  });

  const createMockJob = (overrides?: Partial<Job>): Job => ({
    data: { verificationId: 'verification-uuid-1' },
    attemptsMade: 0,
    ...overrides,
  } as unknown as Job);

  const mockUser: Partial<User> = {
    id: 'user-uuid-1',
    fullName: 'John Doe',
    email: 'john@example.com',
  };

  /** OCR result that passes all thresholds */
  const passingOcrResult = {
    extractedName: 'John Doe',
    extractedDocumentNumber: 'AB123456',
    extractedExpiryDate: '2030-01-01',
    extractedDocumentType: 'PASSPORT',
    faceDetected: true,
    confidence: 0.95,
  };

  /** Liveness result that passes threshold */
  const passingLivenessResult = { livenessScore: 0.97, isLive: true };

  /** Face comparison result that passes threshold */
  const passingFaceResult = { similarityScore: 0.92, isMatch: true };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycProcessJob,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfigValues[key];
              if (value === undefined && key.startsWith('KYC_')) {
                throw new Error(`Config key "${key}" not found`);
              }
              return value;
            }),
            get: jest.fn((key: string) => mockConfigValues[key] ?? null),
          },
        },
        {
          provide: getRepositoryToken(KycVerification),
          useValue: mockKycRepository,
        },
        {
          provide: getRepositoryToken(KycAuditLog),
          useValue: mockAuditLogRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: KycStateTransitionService,
          useValue: mockStateTransitionService,
        },
        {
          provide: AiClientService,
          useValue: mockAiClientService,
        },
        {
          provide: KycAuditService,
          useValue: mockKycAuditService,
        },
        {
          provide: KycNotificationService,
          useValue: mockKycNotificationService,
        },
      ],
    }).compile();

    job = module.get<KycProcessJob>(KycProcessJob);
  });

  describe('configuration', () => {
    it('should load max retries from config', () => {
      expect(job.maxRetries).toBe(parseInt(MOCK_MAX_RETRIES, 10));
    });

    it('should load backoff from config', () => {
      expect(job.backoffMs).toBe(parseInt(MOCK_BACKOFF_MS, 10));
    });
  });

  describe('happy path: all AI checks pass → VERIFIED', () => {
    it('should process verification through full pipeline and transition to VERIFIED', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockUserRepository.findOneOrFail.mockResolvedValue(mockUser);

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);
      mockAiClientService.detectLiveness.mockResolvedValue(passingLivenessResult);
      mockAiClientService.compareFaces.mockResolvedValue(passingFaceResult);

      await job.process(mockJobInstance);

      // Should transition to PROCESSING first
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.PROCESSING }),
      );

      // Should call all AI services in order
      expect(mockAiClientService.extractDocument).toHaveBeenCalledWith({
        imageKey: verification.documentStorageKey,
        correlationId: verification.id,
      });
      expect(mockAiClientService.detectLiveness).toHaveBeenCalledWith({
        selfieImageKey: verification.selfieStorageKey,
        correlationId: verification.id,
      });
      expect(mockAiClientService.compareFaces).toHaveBeenCalledWith({
        documentImageKey: verification.documentStorageKey,
        selfieImageKey: verification.selfieStorageKey,
        correlationId: verification.id,
      });

      // Should transition to VERIFIED
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.VERIFIED }),
      );

      // Should persist scores
      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        expect.objectContaining({
          ocrConfidence: passingOcrResult.confidence,
          faceSimilarityScore: passingFaceResult.similarityScore,
          livenessScore: passingLivenessResult.livenessScore,
          extractedName: passingOcrResult.extractedName,
        }),
      );

      // Should create audit log entries
      expect(mockKycAuditService.logStateTransition).toHaveBeenCalled();
    });
  });

  describe('OCR deterministic failure → REJECTED', () => {
    it('should short-circuit and reject when OCR returns 4xx', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      const ocrError = new AiServiceHttpError(
        'Cannot read document',
        verification.id,
        422,
        'OCR_FAILED',
      );
      mockAiClientService.extractDocument.mockRejectedValue(ocrError);

      await job.process(mockJobInstance);

      // Should NOT call liveness or face compare (short-circuit)
      expect(mockAiClientService.detectLiveness).not.toHaveBeenCalled();
      expect(mockAiClientService.compareFaces).not.toHaveBeenCalled();

      // Should transition to REJECTED
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );

      // Should log the error on entity
      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        expect.objectContaining({
          lastProcessingError: expect.stringContaining('Cannot read document'),
        }),
      );
    });
  });

  describe('liveness deterministic failure → REJECTED', () => {
    it('should short-circuit and reject when liveness returns 4xx', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);

      const livenessError = new AiServiceHttpError(
        'Spoofing detected',
        verification.id,
        422,
        'SPOOFING_DETECTED',
      );
      mockAiClientService.detectLiveness.mockRejectedValue(livenessError);

      await job.process(mockJobInstance);

      // Should NOT call face compare (short-circuit)
      expect(mockAiClientService.compareFaces).not.toHaveBeenCalled();

      // Should transition to REJECTED
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );
    });
  });

  describe('face compare below threshold → REJECTED', () => {
    it('should reject when face similarity score is below threshold', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockUserRepository.findOneOrFail.mockResolvedValue(mockUser);

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);
      mockAiClientService.detectLiveness.mockResolvedValue(passingLivenessResult);
      mockAiClientService.compareFaces.mockResolvedValue({
        similarityScore: 0.50, // Below configured threshold
        isMatch: false,
      });

      await job.process(mockJobInstance);

      // Should reject due to low face similarity
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );

      // Should include face similarity in rejection reason
      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        expect.objectContaining({
          rejectionReason: expect.stringContaining('Face similarity'),
        }),
      );
    });
  });

  describe('transient failure → throws for BullMQ retry', () => {
    it('should throw on 5xx error to allow BullMQ retry', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob({ attemptsMade: 0 });

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      const serverError = new AiServiceHttpError(
        'Internal server error',
        verification.id,
        500,
        'INTERNAL_ERROR',
      );
      mockAiClientService.extractDocument.mockRejectedValue(serverError);

      await expect(job.process(mockJobInstance)).rejects.toThrow(AiServiceHttpError);

      // Should log the error on the entity
      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        expect.objectContaining({ lastProcessingError: expect.any(String) }),
      );
    });

    it('should throw on network error to allow BullMQ retry', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob({ attemptsMade: 0 });

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      const networkError = new AiServiceNetworkError('Connection refused', verification.id);
      mockAiClientService.extractDocument.mockRejectedValue(networkError);

      await expect(job.process(mockJobInstance)).rejects.toThrow(AiServiceNetworkError);
    });

    it('should throw on timeout error to allow BullMQ retry', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob({ attemptsMade: 0 });

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      const timeoutError = new AiServiceTimeoutError(verification.id);
      mockAiClientService.extractDocument.mockRejectedValue(timeoutError);

      await expect(job.process(mockJobInstance)).rejects.toThrow(AiServiceTimeoutError);
    });
  });

  describe('max retries exhausted → REJECTED with admin review', () => {
    it('should reject with admin review reason when max retries reached', async () => {
      const verification = createMockVerification();
      // attemptsMade >= maxRetries - 1 means exhausted (0-indexed attempts)
      const mockJobInstance = createMockJob({ attemptsMade: 2 });

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      const serverError = new AiServiceHttpError(
        'Service unavailable',
        verification.id,
        503,
        'SERVICE_UNAVAILABLE',
      );
      mockAiClientService.extractDocument.mockRejectedValue(serverError);

      // Should NOT throw — should handle gracefully
      await job.process(mockJobInstance);

      // Should transition to REJECTED with admin review reason
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );

      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        expect.objectContaining({
          rejectionReason: expect.stringContaining('admin review'),
        }),
      );
    });
  });

  describe('name match score calculation', () => {
    it('should return 1.0 for exact match', () => {
      const score = job.computeNormalizedSimilarity('John Doe', 'John Doe');
      expect(score).toBe(1.0);
    });

    it('should return 1.0 for case-insensitive match', () => {
      const score = job.computeNormalizedSimilarity('JOHN DOE', 'john doe');
      expect(score).toBe(1.0);
    });

    it('should return 1.0 with extra whitespace normalization', () => {
      const score = job.computeNormalizedSimilarity('  John   Doe  ', 'John Doe');
      expect(score).toBe(1.0);
    });

    it('should return high score for similar names', () => {
      const score = job.computeNormalizedSimilarity('John Doe', 'Jon Doe');
      expect(score).toBeGreaterThan(0.8);
    });

    it('should return low score for very different names', () => {
      const score = job.computeNormalizedSimilarity('John Doe', 'Maria Garcia Lopez');
      expect(score).toBeLessThan(0.5);
    });

    it('should return 0 for empty strings', () => {
      const score = job.computeNormalizedSimilarity('', 'John Doe');
      expect(score).toBe(0.0);
    });

    it('should handle accented characters correctly', () => {
      const score = job.computeNormalizedSimilarity('José García', 'josé garcía');
      expect(score).toBe(1.0);
    });
  });

  describe('processing attempts tracking', () => {
    it('should increment processing attempts on each job run', async () => {
      const verification = createMockVerification({ processingAttempts: 1 });
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockUserRepository.findOneOrFail.mockResolvedValue(mockUser);

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);
      mockAiClientService.detectLiveness.mockResolvedValue(passingLivenessResult);
      mockAiClientService.compareFaces.mockResolvedValue(passingFaceResult);

      await job.process(mockJobInstance);

      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        { processingAttempts: 2 },
      );
    });
  });

  describe('audit logging', () => {
    it('should create audit log for SELFIE_UPLOADED → PROCESSING transition', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockUserRepository.findOneOrFail.mockResolvedValue(mockUser);

      mockStateTransitionService.transition
        .mockResolvedValueOnce({
          verificationId: verification.id,
          previousStatus: KycStatus.SELFIE_UPLOADED,
          newStatus: KycStatus.PROCESSING,
          wasIdempotent: false,
          transitionedAt: new Date(),
        })
        .mockResolvedValue({
          verificationId: verification.id,
          previousStatus: KycStatus.PROCESSING,
          newStatus: KycStatus.VERIFIED,
          wasIdempotent: false,
          transitionedAt: new Date(),
        });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);
      mockAiClientService.detectLiveness.mockResolvedValue(passingLivenessResult);
      mockAiClientService.compareFaces.mockResolvedValue(passingFaceResult);

      await job.process(mockJobInstance);

      // Should create audit log for PROCESSING transition
      expect(mockKycAuditService.logStateTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          oldStatus: KycStatus.SELFIE_UPLOADED,
          newStatus: KycStatus.PROCESSING,
        }),
      );

      // Should create audit log for VERIFIED transition
      expect(mockKycAuditService.logStateTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          oldStatus: KycStatus.PROCESSING,
          newStatus: KycStatus.VERIFIED,
        }),
      );
    });
  });

  describe('face compare deterministic failure → REJECTED', () => {
    it('should short-circuit and reject when face compare returns 4xx', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);
      mockAiClientService.detectLiveness.mockResolvedValue(passingLivenessResult);

      const faceError = new AiServiceHttpError(
        'Multiple faces detected',
        verification.id,
        422,
        'MULTIPLE_FACES',
      );
      mockAiClientService.compareFaces.mockRejectedValue(faceError);

      await job.process(mockJobInstance);

      // Should transition to REJECTED
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );
    });
  });

  describe('OCR confidence below threshold → REJECTED', () => {
    it('should reject when OCR confidence is below configured threshold', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockUserRepository.findOneOrFail.mockResolvedValue(mockUser);

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue({
        ...passingOcrResult,
        confidence: 0.60, // Below configured OCR threshold
      });
      mockAiClientService.detectLiveness.mockResolvedValue(passingLivenessResult);
      mockAiClientService.compareFaces.mockResolvedValue(passingFaceResult);

      await job.process(mockJobInstance);

      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );
    });
  });

  describe('liveness score below threshold → REJECTED', () => {
    it('should reject when liveness score is below configured threshold', async () => {
      const verification = createMockVerification();
      const mockJobInstance = createMockJob();

      mockKycRepository.findOneOrFail.mockResolvedValue(verification);
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockUserRepository.findOneOrFail.mockResolvedValue(mockUser);

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: verification.id,
        previousStatus: KycStatus.SELFIE_UPLOADED,
        newStatus: KycStatus.PROCESSING,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAiClientService.extractDocument.mockResolvedValue(passingOcrResult);
      mockAiClientService.detectLiveness.mockResolvedValue({
        livenessScore: 0.70, // Below configured liveness threshold
        isLive: false,
      });
      mockAiClientService.compareFaces.mockResolvedValue(passingFaceResult);

      await job.process(mockJobInstance);

      expect(mockStateTransitionService.transition).toHaveBeenCalledWith(
        expect.objectContaining({ targetStatus: KycStatus.REJECTED }),
      );

      expect(mockKycRepository.update).toHaveBeenCalledWith(
        verification.id,
        expect.objectContaining({
          rejectionReason: expect.stringContaining('Liveness score'),
        }),
      );
    });
  });
});

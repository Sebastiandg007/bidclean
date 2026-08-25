import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { KycAdminService } from '../admin/kyc-admin.service';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycAuditService } from '../kyc-audit.service';
import { KycNotificationService } from '../kyc-notification.service';
import { KycStorageService } from '../storage/kyc-storage.service';
import { AdminDecision } from '../dto/admin-decision.dto';
import { KycStatus, DocumentType } from '../kyc.types';

describe('KycAdminService', () => {
  let service: KycAdminService;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockAuditLogRepository = {
    create: jest.fn((entity) => entity),
    save: jest.fn(),
  };

  const mockStateTransitionService = {
    transition: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycAdminService,
        {
          provide: getRepositoryToken(KycVerification),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(KycAuditLog),
          useValue: mockAuditLogRepository,
        },
        {
          provide: KycStateTransitionService,
          useValue: mockStateTransitionService,
        },
        {
          provide: KycAuditService,
          useValue: mockKycAuditService,
        },
        {
          provide: KycNotificationService,
          useValue: mockKycNotificationService,
        },
        {
          provide: KycStorageService,
          useValue: {
            getPresignedUrl: jest.fn().mockResolvedValue('https://storage.example.com/presigned'),
          },
        },
      ],
    }).compile();

    service = module.get<KycAdminService>(KycAdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getReviewQueue', () => {
    const mockVerification = {
      id: 'uuid-1',
      userId: 'user-1',
      status: KycStatus.PROCESSING,
      attemptNumber: 1,
      documentType: DocumentType.PASSPORT,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      processingStartedAt: new Date('2024-01-01T01:00:00Z'),
    };

    it('should return paginated results with correct filtering and sorting', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockVerification], 1]);

      const result = await service.getReviewQueue(1, 20);

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('v');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'v.id',
        'v.userId',
        'v.status',
        'v.attemptNumber',
        'v.documentType',
        'v.createdAt',
        'v.processingStartedAt',
      ]);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'v.status IN (:...statuses)',
        { statuses: [KycStatus.PROCESSING, KycStatus.REJECTED] },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('v.createdAt', 'ASC');
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);

      expect(result).toEqual({
        items: [
          {
            id: 'uuid-1',
            userId: 'user-1',
            status: KycStatus.PROCESSING,
            attemptNumber: 1,
            documentType: DocumentType.PASSPORT,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            processingStartedAt: new Date('2024-01-01T01:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should handle empty queue', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.getReviewQueue();

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('should paginate correctly with page 2', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockVerification], 25]);

      const result = await service.getReviewQueue(2, 10);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(3);
    });

    it('should clamp limit to max 100', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.getReviewQueue(1, 500);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(100);
    });

    it('should default to page 1 and limit 20 when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.getReviewQueue();

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should treat negative page as 1', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.getReviewQueue(-1, 20);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(result.page).toBe(1);
    });
  });

  describe('getVerificationDetail', () => {
    const fullVerification = {
      id: 'uuid-detail',
      userId: 'user-2',
      status: KycStatus.REJECTED,
      attemptNumber: 2,
      documentType: DocumentType.NATIONAL_ID,
      extractedName: 'John Doe',
      extractedDocumentNumber: 'ABC123',
      extractedExpiryDate: new Date('2025-12-31'),
      ocrConfidence: 0.95,
      faceSimilarityScore: 0.88,
      livenessScore: 0.92,
      nameMatchScore: 0.85,
      rejectionReason: 'Document expired',
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2024-01-15T10:00:00Z'),
      createdAt: new Date('2024-01-10T00:00:00Z'),
      updatedAt: new Date('2024-01-15T10:00:00Z'),
    };

    it('should return detail for a valid verification ID', async () => {
      mockRepository.findOne.mockResolvedValue(fullVerification);

      const result = await service.getVerificationDetail('uuid-detail');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-detail' },
      });
      expect(result).toEqual({
        id: 'uuid-detail',
        userId: 'user-2',
        status: KycStatus.REJECTED,
        attemptNumber: 2,
        documentType: DocumentType.NATIONAL_ID,
        extractedName: 'John Doe',
        extractedDocumentNumber: 'ABC123',
        extractedExpiryDate: new Date('2025-12-31'),
        ocrConfidence: 0.95,
        faceSimilarityScore: 0.88,
        livenessScore: 0.92,
        nameMatchScore: 0.85,
        rejectionReason: 'Document expired',
        reviewedBy: 'admin-1',
        reviewedAt: new Date('2024-01-15T10:00:00Z'),
        createdAt: new Date('2024-01-10T00:00:00Z'),
        updatedAt: new Date('2024-01-15T10:00:00Z'),
      });
    });

    it('should throw NotFoundException for an invalid ID', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getVerificationDetail('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('makeDecision', () => {
    const adminUserId = 'admin-uuid-1';

    const processingVerification = {
      id: 'verification-1',
      userId: 'user-1',
      status: KycStatus.PROCESSING,
      attemptNumber: 1,
      documentType: DocumentType.PASSPORT,
      extractedName: 'Jane Smith',
      extractedDocumentNumber: 'P123456',
      extractedExpiryDate: new Date('2026-06-15'),
      ocrConfidence: 0.96,
      faceSimilarityScore: 0.91,
      livenessScore: 0.94,
      nameMatchScore: 0.89,
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date('2024-02-01T00:00:00Z'),
      updatedAt: new Date('2024-02-01T01:00:00Z'),
    };

    it('should approve a verification: transition to VERIFIED and create audit log', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce(processingVerification)
        .mockResolvedValueOnce({
          ...processingVerification,
          status: KycStatus.VERIFIED,
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
        });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: processingVerification.id,
        previousStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.VERIFIED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAuditLogRepository.save.mockResolvedValue({});

      const result = await service.makeDecision(
        processingVerification.id,
        { decision: AdminDecision.APPROVE },
        adminUserId,
      );

      expect(mockStateTransitionService.transition).toHaveBeenCalledWith({
        targetStatus: KycStatus.VERIFIED,
        context: {
          verification: processingVerification,
          reviewedBy: adminUserId,
          rejectionReason: undefined,
        },
      });

      expect(mockKycAuditService.logAdminDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationId: processingVerification.id,
          actorId: adminUserId,
          decision: 'VERIFICATION_APPROVED',
          newStatus: KycStatus.VERIFIED,
        }),
      );

      expect(result.status).toBe(KycStatus.VERIFIED);
    });

    it('should reject a verification: transition to REJECTED with reason and create audit log', async () => {
      const rejectionReason = 'Document appears to be tampered with';

      mockRepository.findOne
        .mockResolvedValueOnce(processingVerification)
        .mockResolvedValueOnce({
          ...processingVerification,
          status: KycStatus.REJECTED,
          rejectionReason,
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
        });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: processingVerification.id,
        previousStatus: KycStatus.PROCESSING,
        newStatus: KycStatus.REJECTED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAuditLogRepository.save.mockResolvedValue({});

      const result = await service.makeDecision(
        processingVerification.id,
        { decision: AdminDecision.REJECT, rejectionReason },
        adminUserId,
      );

      expect(mockStateTransitionService.transition).toHaveBeenCalledWith({
        targetStatus: KycStatus.REJECTED,
        context: {
          verification: processingVerification,
          reviewedBy: adminUserId,
          rejectionReason,
        },
      });

      expect(mockKycAuditService.logAdminDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationId: processingVerification.id,
          actorId: adminUserId,
          decision: 'VERIFICATION_REJECTED',
          newStatus: KycStatus.REJECTED,
        }),
      );

      expect(result.status).toBe(KycStatus.REJECTED);
    });

    it('should throw BadRequestException when rejecting without reason', async () => {
      mockRepository.findOne.mockResolvedValue(processingVerification);

      await expect(
        service.makeDecision(
          processingVerification.id,
          { decision: AdminDecision.REJECT },
          adminUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when verification does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.makeDecision(
          'non-existent-id',
          { decision: AdminDecision.APPROVE },
          adminUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when verification is NOT_STARTED (not reviewable)', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...processingVerification,
        status: KycStatus.NOT_STARTED,
      });

      await expect(
        service.makeDecision(
          processingVerification.id,
          { decision: AdminDecision.APPROVE },
          adminUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when verification is already VERIFIED', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...processingVerification,
        status: KycStatus.VERIFIED,
      });

      await expect(
        service.makeDecision(
          processingVerification.id,
          { decision: AdminDecision.APPROVE },
          adminUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow decision on REJECTED verification (admin override)', async () => {
      const rejectedVerification = {
        ...processingVerification,
        status: KycStatus.REJECTED,
        rejectionReason: 'Previous reason',
      };

      mockRepository.findOne
        .mockResolvedValueOnce(rejectedVerification)
        .mockResolvedValueOnce({
          ...rejectedVerification,
          status: KycStatus.VERIFIED,
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
        });

      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: rejectedVerification.id,
        previousStatus: KycStatus.REJECTED,
        newStatus: KycStatus.VERIFIED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });

      mockAuditLogRepository.save.mockResolvedValue({});

      const result = await service.makeDecision(
        rejectedVerification.id,
        { decision: AdminDecision.APPROVE },
        adminUserId,
      );

      expect(result.status).toBe(KycStatus.VERIFIED);
    });
  });
});

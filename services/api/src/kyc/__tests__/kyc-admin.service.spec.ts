import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { KycAdminService } from '../admin/kyc-admin.service';
import { KycVerification } from '../entities/kyc-verification.entity';
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycAdminService,
        {
          provide: getRepositoryToken(KycVerification),
          useValue: mockRepository,
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
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { KycService } from '../kyc.service';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStorageService } from '../storage/kyc-storage.service';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycProcessJob } from '../jobs/kyc-process.job';
import { KycStatus, DocumentType } from '../kyc.types';
import { User } from '../../auth/entities/user.entity';

describe('KycService', () => {
  let service: KycService;

  const mockKycRepository = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockAuditLogRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockStorageService = {
    upload: jest.fn(),
  };

  const mockStateTransitionService = {
    transition: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      const config: Record<string, string> = {
        KYC_MAX_ATTEMPTS: '3',
        KYC_MAX_FILE_SIZE_MB: '10',
        KYC_PROCESSING_MAX_RETRIES: '3',
        KYC_PROCESSING_BACKOFF_MS: '5000',
      };
      return config[key];
    }),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  const mockUser: Partial<User> = {
    id: 'user-uuid-123',
    keycloakId: 'keycloak-id-123',
    email: 'cleaner@test.com',
    roles: ['cleaner'],
    fullName: 'Test Cleaner',
  };

  const mockVerification: Partial<KycVerification> = {
    id: 'verification-uuid-123',
    userId: 'user-uuid-123',
    status: KycStatus.NOT_STARTED,
    attemptNumber: 1,
    documentType: null,
    documentStorageKey: null,
    selfieStorageKey: null,
    rejectionReason: null,
    completedAt: null,
  };

  const mockFile = {
    mimetype: 'image/jpeg',
    size: 2 * 1024 * 1024,
    buffer: Buffer.from('fake-image-data'),
  };

  const mockDto = {
    documentType: DocumentType.PASSPORT,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: getRepositoryToken(KycVerification), useValue: mockKycRepository },
        { provide: getRepositoryToken(KycAuditLog), useValue: mockAuditLogRepository },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: KycStorageService, useValue: mockStorageService },
        { provide: KycStateTransitionService, useValue: mockStateTransitionService },
        { provide: KycProcessJob, useValue: { maxRetries: 3, backoffMs: 5000 } },
        { provide: getQueueToken('kyc-processing'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadDocument', () => {
    it('should upload document successfully for a cleaner', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(mockVerification);
      mockStorageService.upload.mockResolvedValue({
        key: 'kyc/user-uuid-123/document/file-id.jpg',
        bucket: 'kyc-documents',
        etag: 'etag-123',
      });
      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: 'verification-uuid-123',
        previousStatus: KycStatus.NOT_STARTED,
        newStatus: KycStatus.DOCUMENT_UPLOADED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockAuditLogRepository.create.mockReturnValue({});
      mockAuditLogRepository.save.mockResolvedValue({});
      mockKycRepository.findOneOrFail.mockResolvedValue({
        ...mockVerification,
        status: KycStatus.DOCUMENT_UPLOADED,
        documentType: DocumentType.PASSPORT,
        documentStorageKey: 'kyc/user-uuid-123/document/file-id.jpg',
      });

      const result = await service.uploadDocument(
        'keycloak-id-123',
        mockDto,
        mockFile,
      );

      expect(result.status).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(result.attemptNumber).toBe(1);
      expect(mockStorageService.upload).toHaveBeenCalledWith({
        buffer: mockFile.buffer,
        mimeType: 'image/jpeg',
        userId: 'user-uuid-123',
        category: 'document',
      });
      expect(mockStateTransitionService.transition).toHaveBeenCalled();
      expect(mockAuditLogRepository.save).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user has no cleaner role', async () => {
      const hostUser = { ...mockUser, roles: ['host'] };
      mockUserRepository.findOne.mockResolvedValue(hostUser);

      await expect(
        service.uploadDocument('keycloak-id-123', mockDto, mockFile),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.uploadDocument('unknown-keycloak-id', mockDto, mockFile),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for invalid file type', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const invalidFile = { ...mockFile, mimetype: 'application/pdf' };

      await expect(
        service.uploadDocument('keycloak-id-123', mockDto, invalidFile),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw PayloadTooLargeException for oversized file', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const largeFile = { ...mockFile, size: 15 * 1024 * 1024 };

      await expect(
        service.uploadDocument('keycloak-id-123', mockDto, largeFile),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('should return existing status for idempotent upload with idempotency key', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const uploadedVerification = {
        ...mockVerification,
        status: KycStatus.DOCUMENT_UPLOADED,
        documentStorageKey: 'kyc/user-uuid-123/document/existing.jpg',
      };
      mockKycRepository.findOne.mockResolvedValue(uploadedVerification);

      const result = await service.uploadDocument(
        'keycloak-id-123',
        mockDto,
        mockFile,
        'idempotency-key-abc',
      );

      expect(result.status).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(mockStorageService.upload).not.toHaveBeenCalled();
      expect(mockStateTransitionService.transition).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when KYC is already verified', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const verifiedRecord = {
        ...mockVerification,
        status: KycStatus.VERIFIED,
        documentStorageKey: 'kyc/user-uuid-123/document/old.jpg',
      };
      mockKycRepository.findOne.mockResolvedValue(verifiedRecord);

      await expect(
        service.uploadDocument('keycloak-id-123', mockDto, mockFile),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a new verification if none exists', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(null);

      const newVerification = {
        ...mockVerification,
        id: 'new-verification-uuid',
      };
      mockKycRepository.create.mockReturnValue(newVerification);
      mockKycRepository.save.mockResolvedValue(newVerification);
      mockStorageService.upload.mockResolvedValue({
        key: 'kyc/user-uuid-123/document/file-id.jpg',
        bucket: 'kyc-documents',
        etag: 'etag-123',
      });
      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: 'new-verification-uuid',
        previousStatus: KycStatus.NOT_STARTED,
        newStatus: KycStatus.DOCUMENT_UPLOADED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockAuditLogRepository.create.mockReturnValue({});
      mockAuditLogRepository.save.mockResolvedValue({});
      mockKycRepository.findOneOrFail.mockResolvedValue({
        ...newVerification,
        status: KycStatus.DOCUMENT_UPLOADED,
      });

      const result = await service.uploadDocument(
        'keycloak-id-123',
        mockDto,
        mockFile,
      );

      expect(result.status).toBe(KycStatus.DOCUMENT_UPLOADED);
      expect(mockKycRepository.create).toHaveBeenCalledWith({
        userId: 'user-uuid-123',
        status: KycStatus.NOT_STARTED,
        attemptNumber: 1,
      });
      expect(mockKycRepository.save).toHaveBeenCalled();
    });

    it('should accept all valid MIME types', async () => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

      for (const mimeType of validTypes) {
        jest.clearAllMocks();
        mockUserRepository.findOne.mockResolvedValue(mockUser);
        mockKycRepository.findOne.mockResolvedValue(mockVerification);
        mockStorageService.upload.mockResolvedValue({
          key: `kyc/user-uuid-123/document/file.${mimeType.split('/')[1]}`,
          bucket: 'kyc-documents',
          etag: 'etag',
        });
        mockStateTransitionService.transition.mockResolvedValue({
          verificationId: 'verification-uuid-123',
          previousStatus: KycStatus.NOT_STARTED,
          newStatus: KycStatus.DOCUMENT_UPLOADED,
          wasIdempotent: false,
          transitionedAt: new Date(),
        });
        mockKycRepository.update.mockResolvedValue({ affected: 1 });
        mockAuditLogRepository.create.mockReturnValue({});
        mockAuditLogRepository.save.mockResolvedValue({});
        mockKycRepository.findOneOrFail.mockResolvedValue({
          ...mockVerification,
          status: KycStatus.DOCUMENT_UPLOADED,
        });

        const file = { ...mockFile, mimetype: mimeType };

        await expect(
          service.uploadDocument('keycloak-id-123', mockDto, file),
        ).resolves.toBeDefined();
      }
    });

    it('should accept file exactly at the size limit', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(mockVerification);
      mockStorageService.upload.mockResolvedValue({
        key: 'kyc/user-uuid-123/document/file.jpg',
        bucket: 'kyc-documents',
        etag: 'etag',
      });
      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: 'verification-uuid-123',
        previousStatus: KycStatus.NOT_STARTED,
        newStatus: KycStatus.DOCUMENT_UPLOADED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockAuditLogRepository.create.mockReturnValue({});
      mockAuditLogRepository.save.mockResolvedValue({});
      mockKycRepository.findOneOrFail.mockResolvedValue({
        ...mockVerification,
        status: KycStatus.DOCUMENT_UPLOADED,
      });

      const exactLimitFile = { ...mockFile, size: 10 * 1024 * 1024 };

      await expect(
        service.uploadDocument('keycloak-id-123', mockDto, exactLimitFile),
      ).resolves.toBeDefined();
    });
  });
});

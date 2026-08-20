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
import { KycStatus } from '../kyc.types';
import { User } from '../../auth/entities/user.entity';

describe('KycService — uploadSelfie', () => {
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

  const mockQueue = {
    add: jest.fn(),
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

  const mockUser: Partial<User> = {
    id: 'user-uuid-123',
    keycloakId: 'keycloak-id-123',
    email: 'cleaner@test.com',
    roles: ['cleaner'],
    fullName: 'Test Cleaner',
  };

  const mockVerificationWithDocument: Partial<KycVerification> = {
    id: 'verification-uuid-123',
    userId: 'user-uuid-123',
    status: KycStatus.DOCUMENT_UPLOADED,
    attemptNumber: 1,
    documentType: null,
    documentStorageKey: 'kyc/user-uuid-123/document/doc.jpg',
    selfieStorageKey: null,
    rejectionReason: null,
    completedAt: null,
  };

  const mockFile = {
    mimetype: 'image/jpeg',
    size: 2 * 1024 * 1024,
    buffer: Buffer.from('fake-selfie-data'),
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

  describe('happy path', () => {
    it('should upload selfie successfully and enqueue processing job', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(mockVerificationWithDocument);
      mockStorageService.upload.mockResolvedValue({
        key: 'kyc/user-uuid-123/selfie/file-id.jpg',
        bucket: 'kyc-documents',
        etag: 'etag-456',
      });
      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: 'verification-uuid-123',
        previousStatus: KycStatus.DOCUMENT_UPLOADED,
        newStatus: KycStatus.SELFIE_UPLOADED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockAuditLogRepository.create.mockReturnValue({});
      mockAuditLogRepository.save.mockResolvedValue({});
      mockQueue.add.mockResolvedValue({});
      mockKycRepository.findOneOrFail.mockResolvedValue({
        ...mockVerificationWithDocument,
        status: KycStatus.SELFIE_UPLOADED,
        selfieStorageKey: 'kyc/user-uuid-123/selfie/file-id.jpg',
      });

      const result = await service.uploadSelfie('keycloak-id-123', mockFile);

      expect(result.status).toBe(KycStatus.SELFIE_UPLOADED);
      expect(result.attemptNumber).toBe(1);
      expect(mockStorageService.upload).toHaveBeenCalledWith({
        buffer: mockFile.buffer,
        mimeType: 'image/jpeg',
        userId: 'user-uuid-123',
        category: 'selfie',
      });
      expect(mockStateTransitionService.transition).toHaveBeenCalledWith({
        targetStatus: KycStatus.SELFIE_UPLOADED,
        context: {
          verification: mockVerificationWithDocument,
          selfieStorageKey: 'kyc/user-uuid-123/selfie/file-id.jpg',
        },
      });
      expect(mockKycRepository.update).toHaveBeenCalledWith(
        'verification-uuid-123',
        { selfieStorageKey: 'kyc/user-uuid-123/selfie/file-id.jpg' },
      );
      expect(mockAuditLogRepository.save).toHaveBeenCalled();
    });
  });

  describe('BullMQ job enqueue', () => {
    it('should enqueue processing job with correct configuration', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(mockVerificationWithDocument);
      mockStorageService.upload.mockResolvedValue({
        key: 'kyc/user-uuid-123/selfie/file-id.jpg',
        bucket: 'kyc-documents',
        etag: 'etag-456',
      });
      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: 'verification-uuid-123',
        previousStatus: KycStatus.DOCUMENT_UPLOADED,
        newStatus: KycStatus.SELFIE_UPLOADED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockAuditLogRepository.create.mockReturnValue({});
      mockAuditLogRepository.save.mockResolvedValue({});
      mockQueue.add.mockResolvedValue({});
      mockKycRepository.findOneOrFail.mockResolvedValue({
        ...mockVerificationWithDocument,
        status: KycStatus.SELFIE_UPLOADED,
        selfieStorageKey: 'kyc/user-uuid-123/selfie/file-id.jpg',
      });

      await service.uploadSelfie('keycloak-id-123', mockFile);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-verification',
        { verificationId: 'verification-uuid-123' },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    });
  });

  describe('role validation', () => {
    it('should throw ForbiddenException when user is not a cleaner', async () => {
      const hostUser = { ...mockUser, roles: ['host'] };
      mockUserRepository.findOne.mockResolvedValue(hostUser);

      await expect(
        service.uploadSelfie('keycloak-id-123', mockFile),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.uploadSelfie('unknown-id', mockFile),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('file validation', () => {
    it('should throw BadRequestException for invalid file type', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const invalidFile = { ...mockFile, mimetype: 'application/pdf' };

      await expect(
        service.uploadSelfie('keycloak-id-123', invalidFile),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw PayloadTooLargeException for oversized file', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const largeFile = { ...mockFile, size: 15 * 1024 * 1024 };

      await expect(
        service.uploadSelfie('keycloak-id-123', largeFile),
      ).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('state conflict', () => {
    it('should throw ConflictException when document has not been uploaded', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const notStartedVerification = {
        ...mockVerificationWithDocument,
        status: KycStatus.NOT_STARTED,
        documentStorageKey: null,
      };
      mockKycRepository.findOne.mockResolvedValue(notStartedVerification);

      await expect(
        service.uploadSelfie('keycloak-id-123', mockFile),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when no verification exists', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(null);

      await expect(
        service.uploadSelfie('keycloak-id-123', mockFile),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('already verified', () => {
    it('should throw ConflictException when already verified', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const verifiedRecord = {
        ...mockVerificationWithDocument,
        status: KycStatus.VERIFIED,
      };
      mockKycRepository.findOne.mockResolvedValue(verifiedRecord);

      await expect(
        service.uploadSelfie('keycloak-id-123', mockFile),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('idempotency', () => {
    it('should return current status when selfie already uploaded with idempotency key', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const selfieUploadedVerification = {
        ...mockVerificationWithDocument,
        status: KycStatus.SELFIE_UPLOADED,
        selfieStorageKey: 'kyc/user-uuid-123/selfie/existing.jpg',
      };
      mockKycRepository.findOne.mockResolvedValue(selfieUploadedVerification);

      const result = await service.uploadSelfie(
        'keycloak-id-123',
        mockFile,
        'idempotency-key-abc',
      );

      expect(result.status).toBe(KycStatus.SELFIE_UPLOADED);
      expect(mockStorageService.upload).not.toHaveBeenCalled();
      expect(mockStateTransitionService.transition).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should return current status when already processing with idempotency key', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      const processingVerification = {
        ...mockVerificationWithDocument,
        status: KycStatus.PROCESSING,
        selfieStorageKey: 'kyc/user-uuid-123/selfie/existing.jpg',
      };
      mockKycRepository.findOne.mockResolvedValue(processingVerification);

      const result = await service.uploadSelfie(
        'keycloak-id-123',
        mockFile,
        'idempotency-key-abc',
      );

      expect(result.status).toBe(KycStatus.PROCESSING);
      expect(mockStorageService.upload).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should NOT be idempotent without idempotency key', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(mockVerificationWithDocument);
      mockStorageService.upload.mockResolvedValue({
        key: 'kyc/user-uuid-123/selfie/file-id.jpg',
        bucket: 'kyc-documents',
        etag: 'etag-456',
      });
      mockStateTransitionService.transition.mockResolvedValue({
        verificationId: 'verification-uuid-123',
        previousStatus: KycStatus.DOCUMENT_UPLOADED,
        newStatus: KycStatus.SELFIE_UPLOADED,
        wasIdempotent: false,
        transitionedAt: new Date(),
      });
      mockKycRepository.update.mockResolvedValue({ affected: 1 });
      mockAuditLogRepository.create.mockReturnValue({});
      mockAuditLogRepository.save.mockResolvedValue({});
      mockQueue.add.mockResolvedValue({});
      mockKycRepository.findOneOrFail.mockResolvedValue({
        ...mockVerificationWithDocument,
        status: KycStatus.SELFIE_UPLOADED,
      });

      await service.uploadSelfie('keycloak-id-123', mockFile);

      expect(mockStorageService.upload).toHaveBeenCalled();
    });
  });
});

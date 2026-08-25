import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { KycService } from '../kyc.service';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStorageService } from '../storage/kyc-storage.service';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycAuditService } from '../kyc-audit.service';
import { KycProcessJob } from '../jobs/kyc-process.job';
import { KycStatus } from '../kyc.types';
import { User } from '../../auth/entities/user.entity';

describe('KycService — getStatus', () => {
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

  const mockCleanerUser: Partial<User> = {
    id: 'user-uuid-100',
    keycloakId: 'kc-cleaner-100',
    email: 'cleaner@example.com',
    roles: ['cleaner'],
    fullName: 'Maria Gomez',
  };

  const mockHostUser: Partial<User> = {
    id: 'user-uuid-200',
    keycloakId: 'kc-host-200',
    email: 'host@example.com',
    roles: ['host'],
    fullName: 'Carlos Ruiz',
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
        {
          provide: KycAuditService,
          useValue: {
            logStateTransition: jest.fn().mockResolvedValue(undefined),
            logDataAccess: jest.fn().mockResolvedValue(undefined),
            logAdminDecision: jest.fn().mockResolvedValue(undefined),
            logDeletion: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: KycProcessJob, useValue: { maxRetries: 3, backoffMs: 5000 } },
        { provide: getQueueToken('kyc-processing'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return NOT_STARTED when no verification exists', async () => {
    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(null);

    const result = await service.getStatus('kc-cleaner-100');

    expect(result).toEqual({
      status: KycStatus.NOT_STARTED,
      attemptNumber: 1,
      rejectionReason: null,
      completedAt: null,
    });
    expect(mockKycRepository.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-uuid-100' },
      order: { attemptNumber: 'DESC' },
    });
  });

  it('should return current status from the latest attempt', async () => {
    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue({
      id: 'ver-uuid-1',
      userId: 'user-uuid-100',
      status: KycStatus.DOCUMENT_UPLOADED,
      attemptNumber: 1,
      rejectionReason: null,
      completedAt: null,
    });

    const result = await service.getStatus('kc-cleaner-100');

    expect(result).toEqual({
      status: KycStatus.DOCUMENT_UPLOADED,
      attemptNumber: 1,
      rejectionReason: null,
      completedAt: null,
    });
  });

  it('should return rejection reason when status is REJECTED', async () => {
    const rejectedAt = new Date('2026-08-20T10:00:00Z');
    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue({
      id: 'ver-uuid-2',
      userId: 'user-uuid-100',
      status: KycStatus.REJECTED,
      attemptNumber: 1,
      rejectionReason: 'Face similarity below threshold',
      completedAt: rejectedAt,
    });

    const result = await service.getStatus('kc-cleaner-100');

    expect(result).toEqual({
      status: KycStatus.REJECTED,
      attemptNumber: 1,
      rejectionReason: 'Face similarity below threshold',
      completedAt: rejectedAt,
    });
  });

  it('should throw ForbiddenException for non-Cleaner users', async () => {
    mockUserRepository.findOne.mockResolvedValue(mockHostUser);

    await expect(service.getStatus('kc-host-200')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockKycRepository.findOne).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when user is not found', async () => {
    mockUserRepository.findOne.mockResolvedValue(null);

    await expect(service.getStatus('kc-unknown')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockKycRepository.findOne).not.toHaveBeenCalled();
  });

  it('should return the highest attempt_number when multiple attempts exist', async () => {
    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    // The repository query uses ORDER BY attemptNumber DESC, LIMIT 1
    // so it returns the latest (highest) attempt directly
    mockKycRepository.findOne.mockResolvedValue({
      id: 'ver-uuid-3',
      userId: 'user-uuid-100',
      status: KycStatus.PROCESSING,
      attemptNumber: 3,
      rejectionReason: null,
      completedAt: null,
    });

    const result = await service.getStatus('kc-cleaner-100');

    expect(result).toEqual({
      status: KycStatus.PROCESSING,
      attemptNumber: 3,
      rejectionReason: null,
      completedAt: null,
    });
  });

  it('should return VERIFIED status with completedAt timestamp', async () => {
    const completedAt = new Date('2026-08-22T15:30:00Z');
    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue({
      id: 'ver-uuid-4',
      userId: 'user-uuid-100',
      status: KycStatus.VERIFIED,
      attemptNumber: 2,
      rejectionReason: null,
      completedAt,
    });

    const result = await service.getStatus('kc-cleaner-100');

    expect(result).toEqual({
      status: KycStatus.VERIFIED,
      attemptNumber: 2,
      rejectionReason: null,
      completedAt,
    });
  });
});

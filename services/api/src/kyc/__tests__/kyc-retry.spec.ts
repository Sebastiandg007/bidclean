import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { KycService } from '../kyc.service';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStorageService } from '../storage/kyc-storage.service';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycAuditService } from '../kyc-audit.service';
import { KycProcessJob } from '../jobs/kyc-process.job';
import { KycStatus } from '../kyc.types';
import { User } from '../../auth/entities/user.entity';

describe('KycService — retry', () => {
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

  const mockKycAuditService = {
    logStateTransition: jest.fn().mockResolvedValue(undefined),
    logDataAccess: jest.fn().mockResolvedValue(undefined),
    logAdminDecision: jest.fn().mockResolvedValue(undefined),
    logDeletion: jest.fn().mockResolvedValue(undefined),
  };

  const mockCleanerUser: Partial<User> = {
    id: 'user-uuid-cleaner',
    keycloakId: 'kc-cleaner-retry',
    email: 'cleaner-retry@example.com',
    roles: ['cleaner'],
    fullName: 'Ana Martinez',
  };

  const mockHostUser: Partial<User> = {
    id: 'user-uuid-host',
    keycloakId: 'kc-host-retry',
    email: 'host-retry@example.com',
    roles: ['host'],
    fullName: 'Pedro Lopez',
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
          useValue: mockKycAuditService,
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

  it('should create a new attempt when previous is REJECTED', async () => {
    const rejectedVerification: Partial<KycVerification> = {
      id: 'ver-uuid-rejected',
      userId: 'user-uuid-cleaner',
      status: KycStatus.REJECTED,
      attemptNumber: 1,
      rejectionReason: 'Face similarity below threshold',
      completedAt: new Date('2026-08-20T10:00:00Z'),
    };

    const newVerification: Partial<KycVerification> = {
      id: 'ver-uuid-new',
      userId: 'user-uuid-cleaner',
      status: KycStatus.NOT_STARTED,
      attemptNumber: 2,
      rejectionReason: null,
      completedAt: null,
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(rejectedVerification);
    mockKycRepository.create.mockReturnValue(newVerification);
    mockKycRepository.save.mockResolvedValue(newVerification);
    mockAuditLogRepository.create.mockReturnValue({});
    mockAuditLogRepository.save.mockResolvedValue({});

    const result = await service.retry('kc-cleaner-retry');

    expect(result).toEqual({
      status: KycStatus.NOT_STARTED,
      attemptNumber: 2,
      rejectionReason: null,
      completedAt: null,
    });
  });

  it('should have correct attemptNumber (previous + 1)', async () => {
    const rejectedAttempt2: Partial<KycVerification> = {
      id: 'ver-uuid-attempt2',
      userId: 'user-uuid-cleaner',
      status: KycStatus.REJECTED,
      attemptNumber: 2,
      rejectionReason: 'Liveness check failed',
      completedAt: new Date('2026-08-21T12:00:00Z'),
    };

    const newAttempt3: Partial<KycVerification> = {
      id: 'ver-uuid-attempt3',
      userId: 'user-uuid-cleaner',
      status: KycStatus.NOT_STARTED,
      attemptNumber: 3,
      rejectionReason: null,
      completedAt: null,
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(rejectedAttempt2);
    mockKycRepository.create.mockReturnValue(newAttempt3);
    mockKycRepository.save.mockResolvedValue(newAttempt3);
    mockAuditLogRepository.create.mockReturnValue({});
    mockAuditLogRepository.save.mockResolvedValue({});

    const result = await service.retry('kc-cleaner-retry');

    expect(result.attemptNumber).toBe(3);
    expect(mockKycRepository.create).toHaveBeenCalledWith({
      userId: 'user-uuid-cleaner',
      status: KycStatus.NOT_STARTED,
      attemptNumber: 3,
    });
  });

  it('should throw 429 HttpException when max attempts exceeded', async () => {
    const rejectedAtMaxAttempts: Partial<KycVerification> = {
      id: 'ver-uuid-max',
      userId: 'user-uuid-cleaner',
      status: KycStatus.REJECTED,
      attemptNumber: 3, // maxAttempts = 3, so this is the limit
      rejectionReason: 'OCR confidence too low',
      completedAt: new Date('2026-08-22T09:00:00Z'),
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(rejectedAtMaxAttempts);

    await expect(service.retry('kc-cleaner-retry')).rejects.toThrow(
      HttpException,
    );

    try {
      await service.retry('kc-cleaner-retry');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    expect(mockKycRepository.create).not.toHaveBeenCalled();
    expect(mockKycRepository.save).not.toHaveBeenCalled();
  });

  it('should throw 409 ConflictException when already VERIFIED', async () => {
    const verifiedVerification: Partial<KycVerification> = {
      id: 'ver-uuid-verified',
      userId: 'user-uuid-cleaner',
      status: KycStatus.VERIFIED,
      attemptNumber: 1,
      rejectionReason: null,
      completedAt: new Date('2026-08-19T14:00:00Z'),
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(verifiedVerification);

    await expect(service.retry('kc-cleaner-retry')).rejects.toThrow(
      ConflictException,
    );
    expect(mockKycRepository.create).not.toHaveBeenCalled();
  });

  it('should throw 403 ForbiddenException when user is not a Cleaner', async () => {
    mockUserRepository.findOne.mockResolvedValue(mockHostUser);

    await expect(service.retry('kc-host-retry')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockKycRepository.findOne).not.toHaveBeenCalled();
  });

  it('should throw 403 ForbiddenException when user is not found', async () => {
    mockUserRepository.findOne.mockResolvedValue(null);

    await expect(service.retry('kc-unknown')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockKycRepository.findOne).not.toHaveBeenCalled();
  });

  it('should preserve previous attempt (not modify it)', async () => {
    const rejectedVerification: Partial<KycVerification> = {
      id: 'ver-uuid-old',
      userId: 'user-uuid-cleaner',
      status: KycStatus.REJECTED,
      attemptNumber: 1,
      rejectionReason: 'Document expired',
      completedAt: new Date('2026-08-20T10:00:00Z'),
    };

    const newVerification: Partial<KycVerification> = {
      id: 'ver-uuid-new-attempt',
      userId: 'user-uuid-cleaner',
      status: KycStatus.NOT_STARTED,
      attemptNumber: 2,
      rejectionReason: null,
      completedAt: null,
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(rejectedVerification);
    mockKycRepository.create.mockReturnValue(newVerification);
    mockKycRepository.save.mockResolvedValue(newVerification);
    mockAuditLogRepository.create.mockReturnValue({});
    mockAuditLogRepository.save.mockResolvedValue({});

    await service.retry('kc-cleaner-retry');

    // Verify the old verification was NOT updated
    expect(mockKycRepository.update).not.toHaveBeenCalled();
    // A new record was created (not modifying the old one)
    expect(mockKycRepository.create).toHaveBeenCalledWith({
      userId: 'user-uuid-cleaner',
      status: KycStatus.NOT_STARTED,
      attemptNumber: 2,
    });
  });

  it('should create an audit log entry for the retry', async () => {
    const rejectedVerification: Partial<KycVerification> = {
      id: 'ver-uuid-for-audit',
      userId: 'user-uuid-cleaner',
      status: KycStatus.REJECTED,
      attemptNumber: 1,
      rejectionReason: 'Multiple faces detected',
      completedAt: new Date('2026-08-20T10:00:00Z'),
    };

    const newVerification: Partial<KycVerification> = {
      id: 'ver-uuid-audit-new',
      userId: 'user-uuid-cleaner',
      status: KycStatus.NOT_STARTED,
      attemptNumber: 2,
      rejectionReason: null,
      completedAt: null,
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(rejectedVerification);
    mockKycRepository.create.mockReturnValue(newVerification);
    mockKycRepository.save.mockResolvedValue(newVerification);
    mockAuditLogRepository.create.mockReturnValue({});
    mockAuditLogRepository.save.mockResolvedValue({});

    await service.retry('kc-cleaner-retry');

    expect(mockKycAuditService.logStateTransition).toHaveBeenCalledWith({
      verificationId: 'ver-uuid-audit-new',
      actorId: 'user-uuid-cleaner',
      oldStatus: KycStatus.REJECTED,
      newStatus: KycStatus.NOT_STARTED,
    });
  });

  it('should throw ConflictException when no verification exists', async () => {
    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(null);

    await expect(service.retry('kc-cleaner-retry')).rejects.toThrow(
      ConflictException,
    );
    expect(mockKycRepository.create).not.toHaveBeenCalled();
  });

  it('should throw ConflictException when status is PROCESSING (not REJECTED)', async () => {
    const processingVerification: Partial<KycVerification> = {
      id: 'ver-uuid-processing',
      userId: 'user-uuid-cleaner',
      status: KycStatus.PROCESSING,
      attemptNumber: 1,
      rejectionReason: null,
      completedAt: null,
    };

    mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
    mockKycRepository.findOne.mockResolvedValue(processingVerification);

    await expect(service.retry('kc-cleaner-retry')).rejects.toThrow(
      ConflictException,
    );
    expect(mockKycRepository.create).not.toHaveBeenCalled();
  });
});

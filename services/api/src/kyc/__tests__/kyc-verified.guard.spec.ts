import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KycVerifiedGuard } from '../guards/kyc-verified.guard';
import { User } from '../../auth/entities/user.entity';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycStatus } from '../kyc.types';

describe('KycVerifiedGuard', () => {
  let guard: KycVerifiedGuard;

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockKycRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycVerifiedGuard,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(KycVerification),
          useValue: mockKycRepository,
        },
      ],
    }).compile();

    guard = module.get<KycVerifiedGuard>(KycVerifiedGuard);
  });

  function createMockContext(keycloakId: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { keycloakId, email: 'test@test.com', emailVerified: true },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  const mockUser: Partial<User> = {
    id: 'user-uuid-123',
    keycloakId: 'kc-uuid-123',
    email: 'cleaner@test.com',
    fullName: 'Test Cleaner',
    country: 'US',
    language: 'en',
    isEmailVerified: true,
    roles: ['cleaner'],
    activeRole: 'cleaner',
  };

  const mockHostUser: Partial<User> = {
    ...mockUser,
    roles: ['host'],
    activeRole: 'host',
  };

  function createVerification(overrides: Partial<KycVerification> = {}): Partial<KycVerification> {
    return {
      id: 'verification-uuid-123',
      userId: 'user-uuid-123',
      status: KycStatus.VERIFIED,
      attemptNumber: 1,
      ...overrides,
    };
  }

  describe('canActivate', () => {
    it('should allow access when cleaner has VERIFIED KYC status', async () => {
      const verification = createVerification({ status: KycStatus.VERIFIED });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(verification);

      const context = createMockContext('kc-uuid-123');
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockKycRepository.findOne).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        order: { attemptNumber: 'DESC' },
      });
    });

    it('should throw ForbiddenException when cleaner has no KYC verification', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(null);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('kyc.error.not_verified');
    });

    it('should throw ForbiddenException when cleaner KYC is REJECTED', async () => {
      const verification = createVerification({ status: KycStatus.REJECTED });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(verification);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('kyc.error.not_verified');
    });

    it('should throw ForbiddenException when cleaner KYC is PROCESSING', async () => {
      const verification = createVerification({ status: KycStatus.PROCESSING });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(verification);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when cleaner KYC is NOT_STARTED', async () => {
      const verification = createVerification({ status: KycStatus.NOT_STARTED });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(verification);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when cleaner KYC is DOCUMENT_UPLOADED', async () => {
      const verification = createVerification({ status: KycStatus.DOCUMENT_UPLOADED });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(verification);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when cleaner KYC is SELFIE_UPLOADED', async () => {
      const verification = createVerification({ status: KycStatus.SELFIE_UPLOADED });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(verification);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should allow access for non-cleaner users (e.g., host)', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockHostUser);

      const context = createMockContext('kc-uuid-123');
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockKycRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not found in database', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const context = createMockContext('nonexistent-kc-id');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('kyc.error.not_verified');
    });

    it('should use the latest verification attempt (highest attempt_number)', async () => {
      const latestVerification = createVerification({
        attemptNumber: 3,
        status: KycStatus.VERIFIED,
      });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(latestVerification);

      const context = createMockContext('kc-uuid-123');
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockKycRepository.findOne).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        order: { attemptNumber: 'DESC' },
      });
    });

    it('should block when latest attempt is REJECTED even if earlier attempt was VERIFIED', async () => {
      const latestVerification = createVerification({
        attemptNumber: 2,
        status: KycStatus.REJECTED,
      });

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockKycRepository.findOne.mockResolvedValue(latestVerification);

      const context = createMockContext('kc-uuid-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});

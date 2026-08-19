import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnboardingGateGuard } from '../guards/onboarding-gate.guard';
import { User } from '../../auth/entities/user.entity';
import { OnboardingStatus, UserRole } from '../roles.types';

describe('OnboardingGateGuard', () => {
  let guard: OnboardingGateGuard;
  let reflector: Reflector;

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const KEYCLOAK_ID = 'kc-user-456';

  const createMockUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-uuid-1',
      keycloakId: KEYCLOAK_ID,
      email: 'test@bidclean.tech',
      fullName: 'Test User',
      country: 'US',
      language: 'en',
      isEmailVerified: true,
      roles: [UserRole.HOST],
      activeRole: UserRole.HOST,
      onboardingStatusHost: OnboardingStatus.COMPLETED,
      onboardingStatusCleaner: OnboardingStatus.NOT_STARTED,
      createdAt: new Date(),
      updatedAt: new Date(),
      sessions: [],
      biometricCredentials: [],
      ...overrides,
    }) as User;

  const createMockExecutionContext = (
    userPayload: { keycloakId: string } = { keycloakId: KEYCLOAK_ID },
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: userPayload }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingGateGuard,
        Reflector,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    guard = module.get<OnboardingGateGuard>(OnboardingGateGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('when onboarding is COMPLETED for the required role', () => {
    it('should allow access for Host with completed onboarding', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.HOST);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST],
          onboardingStatusHost: OnboardingStatus.COMPLETED,
        }),
      );

      const context = createMockExecutionContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access for Cleaner with completed onboarding', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.CLEANER);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.CLEANER],
          onboardingStatusCleaner: OnboardingStatus.COMPLETED,
        }),
      );

      const context = createMockExecutionContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('when onboarding is NOT_STARTED for the required role', () => {
    it('should throw ForbiddenException for Host', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.HOST);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST],
          onboardingStatusHost: OnboardingStatus.NOT_STARTED,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Complete onboarding to access this feature',
      );
    });
  });

  describe('when onboarding is IN_PROGRESS for the required role', () => {
    it('should throw ForbiddenException for Host', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.HOST);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST],
          onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Complete onboarding to access this feature',
      );
    });

    it('should throw ForbiddenException for Cleaner', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.CLEANER);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.CLEANER],
          onboardingStatusCleaner: OnboardingStatus.IN_PROGRESS,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('when user does not have the required role assigned', () => {
    it('should throw ForbiddenException if Host role is required but not assigned', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.HOST);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.CLEANER],
          activeRole: UserRole.CLEANER,
          onboardingStatusCleaner: OnboardingStatus.COMPLETED,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Complete onboarding to access this feature',
      );
    });

    it('should throw ForbiddenException if Cleaner role is required but not assigned', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.CLEANER);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST],
          activeRole: UserRole.HOST,
          onboardingStatusHost: OnboardingStatus.COMPLETED,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('when no specific role is set in metadata (falls back to active_role)', () => {
    it('should use active_role and allow access if onboarding is completed', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST, UserRole.CLEANER],
          activeRole: UserRole.CLEANER,
          onboardingStatusCleaner: OnboardingStatus.COMPLETED,
        }),
      );

      const context = createMockExecutionContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should use active_role and block access if onboarding is incomplete', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST],
          activeRole: UserRole.HOST,
          onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when active_role is null', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [],
          activeRole: null,
        }),
      );

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('error message validation', () => {
    it('should throw 403 with exact message "Complete onboarding to access this feature"', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.HOST);
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({
          roles: [UserRole.HOST],
          onboardingStatusHost: OnboardingStatus.NOT_STARTED,
        }),
      );

      const context = createMockExecutionContext();

      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toBe(
          'Complete onboarding to access this feature',
        );
        expect((error as ForbiddenException).getStatus()).toBe(403);
      }
    });
  });

  describe('when user is not found in database', () => {
    it('should throw ForbiddenException', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(UserRole.HOST);
      mockUserRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});

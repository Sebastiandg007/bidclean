import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { RolesService } from '../roles.service';
import { HostProfile } from '../entities/host-profile.entity';
import { CleanerProfile } from '../entities/cleaner-profile.entity';
import { User } from '../../auth/entities/user.entity';
import { UserRole, OnboardingStatus } from '../roles.types';

describe('RolesService', () => {
  let service: RolesService;

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockHostProfileRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockCleanerProfileRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(HostProfile),
          useValue: mockHostProfileRepository,
        },
        {
          provide: getRepositoryToken(CleanerProfile),
          useValue: mockCleanerProfileRepository,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignRoles', () => {
    const keycloakId = 'kc-user-123';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-1',
        keycloakId,
        email: 'test@example.com',
        fullName: 'Test User',
        country: 'US',
        language: 'en',
        isEmailVerified: true,
        roles: [],
        activeRole: null,
        onboardingStatusHost: OnboardingStatus.NOT_STARTED,
        onboardingStatusCleaner: OnboardingStatus.NOT_STARTED,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as User;

    it('should assign a single role to a user with no previous roles', async () => {
      const user = createMockUser();
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.assignRoles(keycloakId, {
        roles: [UserRole.HOST],
      });

      expect(result.roles).toEqual([UserRole.HOST]);
      expect(result.activeRole).toBe(UserRole.HOST);
      expect(result.message).toBe('Roles assigned successfully');
      expect(user.onboardingStatusHost).toBe(OnboardingStatus.IN_PROGRESS);
    });

    it('should assign both roles to a user', async () => {
      const user = createMockUser();
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.assignRoles(keycloakId, {
        roles: [UserRole.HOST, UserRole.CLEANER],
      });

      expect(result.roles).toContain(UserRole.HOST);
      expect(result.roles).toContain(UserRole.CLEANER);
      expect(result.activeRole).toBe(UserRole.HOST);
      expect(user.onboardingStatusHost).toBe(OnboardingStatus.IN_PROGRESS);
      expect(user.onboardingStatusCleaner).toBe(OnboardingStatus.IN_PROGRESS);
    });

    it('should be idempotent when re-assigning an existing role', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.assignRoles(keycloakId, {
        roles: [UserRole.HOST],
      });

      expect(result.roles).toEqual([UserRole.HOST]);
      expect(result.activeRole).toBe(UserRole.HOST);
      expect(user.onboardingStatusHost).toBe(OnboardingStatus.IN_PROGRESS);
    });

    it('should not overwrite activeRole when already set', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      await service.assignRoles(keycloakId, {
        roles: [UserRole.CLEANER],
      });

      expect(user.activeRole).toBe(UserRole.HOST);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.assignRoles(keycloakId, { roles: [UserRole.HOST] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not reset onboarding status for already-assigned roles', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.COMPLETED,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      await service.assignRoles(keycloakId, {
        roles: [UserRole.HOST, UserRole.CLEANER],
      });

      expect(user.onboardingStatusHost).toBe(OnboardingStatus.COMPLETED);
      expect(user.onboardingStatusCleaner).toBe(OnboardingStatus.IN_PROGRESS);
    });
  });

  describe('getUserRoles', () => {
    it.todo('should return the user roles and active role');
  });

  describe('switchActiveRole', () => {
    it.todo('should switch active role when role is assigned');
    it.todo('should reject switching to a role that is not assigned');
  });

  describe('saveHostProfile', () => {
    it.todo('should create a host profile');
    it.todo('should update an existing host profile');
  });

  describe('saveCleanerProfile', () => {
    it.todo('should create a cleaner profile');
    it.todo('should update an existing cleaner profile');
  });

  describe('getOnboardingStatus', () => {
    it.todo('should return onboarding status per role');
  });
});

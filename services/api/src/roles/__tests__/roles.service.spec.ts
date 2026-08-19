import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
    const keycloakId = 'kc-user-456';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-2',
        keycloakId,
        email: 'roles@example.com',
        fullName: 'Roles User',
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

    it('should return roles and active role for a user with one role', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
      });
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.getUserRoles(keycloakId);

      expect(result.roles).toEqual([UserRole.HOST]);
      expect(result.activeRole).toBe(UserRole.HOST);
    });

    it('should return roles and active role for a user with both roles', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST, UserRole.CLEANER],
        activeRole: UserRole.CLEANER,
      });
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.getUserRoles(keycloakId);

      expect(result.roles).toEqual([UserRole.HOST, UserRole.CLEANER]);
      expect(result.activeRole).toBe(UserRole.CLEANER);
    });

    it('should return empty roles and null activeRole for a new user', async () => {
      const user = createMockUser({ roles: [], activeRole: null });
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.getUserRoles(keycloakId);

      expect(result.roles).toEqual([]);
      expect(result.activeRole).toBeNull();
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserRoles(keycloakId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('switchActiveRole', () => {
    const keycloakId = 'kc-user-789';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-3',
        keycloakId,
        email: 'switch@example.com',
        fullName: 'Switch User',
        country: 'US',
        language: 'en',
        isEmailVerified: true,
        roles: [UserRole.HOST, UserRole.CLEANER],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
        onboardingStatusCleaner: OnboardingStatus.IN_PROGRESS,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as User;

    it('should switch active role when role is assigned', async () => {
      const user = createMockUser();
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.switchActiveRole(keycloakId, UserRole.CLEANER);

      expect(result.activeRole).toBe(UserRole.CLEANER);
      expect(result.message).toContain('cleaner');
      expect(user.activeRole).toBe(UserRole.CLEANER);
      expect(mockUserRepository.save).toHaveBeenCalledWith(user);
    });

    it('should be idempotent when switching to the already-active role', async () => {
      const user = createMockUser({ activeRole: UserRole.HOST });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.switchActiveRole(keycloakId, UserRole.HOST);

      expect(result.activeRole).toBe(UserRole.HOST);
      expect(user.activeRole).toBe(UserRole.HOST);
    });

    it('should throw BadRequestException when role is not assigned', async () => {
      const user = createMockUser({ roles: [UserRole.HOST] });
      mockUserRepository.findOne.mockResolvedValue(user);

      await expect(
        service.switchActiveRole(keycloakId, UserRole.CLEANER),
      ).rejects.toThrow("Role 'cleaner' is not assigned to this user");
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.switchActiveRole(keycloakId, UserRole.HOST),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('saveHostProfile', () => {
    const keycloakId = 'kc-host-001';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-host-1',
        keycloakId,
        email: 'host@example.com',
        fullName: 'Host User',
        country: 'US',
        language: 'en',
        isEmailVerified: true,
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
        onboardingStatusCleaner: OnboardingStatus.NOT_STARTED,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as User;

    it('should create a host profile when none exists', async () => {
      const user = createMockUser();
      const dto = {
        displayName: 'John Host',
        isBusiness: false,
        paymentMethodAdded: true,
      };
      const createdProfile = { userId: user.id };
      const expectedProfile = {
        id: 'profile-uuid',
        userId: user.id,
        displayName: 'John Host',
        isBusiness: false,
        businessName: null,
        paymentMethodAdded: true,
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockHostProfileRepository.findOne.mockResolvedValue(null);
      mockHostProfileRepository.create.mockReturnValue(createdProfile);
      mockHostProfileRepository.save.mockResolvedValue(expectedProfile);

      const result = await service.saveHostProfile(keycloakId, dto);

      expect(result).toEqual(expectedProfile);
      expect(mockHostProfileRepository.create).toHaveBeenCalledWith({
        userId: user.id,
      });
      expect(mockHostProfileRepository.save).toHaveBeenCalled();
    });

    it('should update an existing host profile (upsert behavior)', async () => {
      const user = createMockUser();
      const existingProfile = {
        id: 'profile-uuid',
        userId: user.id,
        displayName: 'Old Name',
        isBusiness: false,
        businessName: null,
        paymentMethodAdded: false,
      };
      const dto = {
        displayName: 'Updated Name',
        isBusiness: true,
        businessName: 'My Business',
        paymentMethodAdded: true,
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockHostProfileRepository.findOne.mockResolvedValue(existingProfile);
      mockHostProfileRepository.save.mockResolvedValue({
        ...existingProfile,
        displayName: 'Updated Name',
        isBusiness: true,
        businessName: 'My Business',
        paymentMethodAdded: true,
      });

      const result = await service.saveHostProfile(keycloakId, dto);

      expect(result.displayName).toBe('Updated Name');
      expect(result.isBusiness).toBe(true);
      expect(result.businessName).toBe('My Business');
      expect(result.paymentMethodAdded).toBe(true);
      expect(mockHostProfileRepository.create).not.toHaveBeenCalled();
    });

    it('should preserve existing fields when partial update is provided', async () => {
      const user = createMockUser();
      const existingProfile = {
        id: 'profile-uuid',
        userId: user.id,
        displayName: 'Existing Name',
        isBusiness: true,
        businessName: 'Existing Biz',
        paymentMethodAdded: true,
      };
      const dto = { displayName: 'New Name' };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockHostProfileRepository.findOne.mockResolvedValue(existingProfile);
      mockHostProfileRepository.save.mockImplementation((p) =>
        Promise.resolve(p),
      );

      const result = await service.saveHostProfile(keycloakId, dto);

      expect(result.displayName).toBe('New Name');
      expect(result.isBusiness).toBe(false);
      expect(result.paymentMethodAdded).toBe(false);
    });

    it('should throw ForbiddenException when user does not have host role', async () => {
      const user = createMockUser({ roles: [UserRole.CLEANER] });
      mockUserRepository.findOne.mockResolvedValue(user);

      await expect(
        service.saveHostProfile(keycloakId, { displayName: 'Test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when isBusiness is true but businessName is missing', async () => {
      const user = createMockUser();
      mockUserRepository.findOne.mockResolvedValue(user);

      await expect(
        service.saveHostProfile(keycloakId, {
          displayName: 'Test',
          isBusiness: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.saveHostProfile(keycloakId, { displayName: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('saveCleanerProfile', () => {
    const keycloakId = 'kc-cleaner-001';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-cleaner-1',
        keycloakId,
        email: 'cleaner@example.com',
        fullName: 'Cleaner User',
        country: 'CO',
        language: 'es',
        isEmailVerified: true,
        roles: [UserRole.CLEANER],
        activeRole: UserRole.CLEANER,
        onboardingStatusHost: OnboardingStatus.NOT_STARTED,
        onboardingStatusCleaner: OnboardingStatus.IN_PROGRESS,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as User;

    it('should create a new cleaner profile when none exists', async () => {
      const user = createMockUser();
      const dto = {
        displayName: 'María López',
        workZoneLat: 4.711,
        workZoneLng: -74.0721,
        workZoneRadiusKm: 10,
        availability: { monday: ['08:00-12:00', '14:00-18:00'] },
        specialties: ['airbnb', 'offices'],
      };
      const expectedProfile = { id: 'profile-uuid', userId: user.id, ...dto };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockCleanerProfileRepository.findOne.mockResolvedValue(null);
      mockCleanerProfileRepository.create.mockReturnValue({ userId: user.id });
      mockCleanerProfileRepository.save.mockResolvedValue(expectedProfile);

      const result = await service.saveCleanerProfile(keycloakId, dto);

      expect(result).toEqual(expectedProfile);
      expect(mockCleanerProfileRepository.create).toHaveBeenCalledWith({
        userId: user.id,
      });
      expect(mockCleanerProfileRepository.save).toHaveBeenCalled();
    });

    it('should update an existing cleaner profile', async () => {
      const user = createMockUser();
      const existingProfile = {
        id: 'profile-uuid',
        userId: user.id,
        displayName: 'María',
        workZoneLat: 4.5,
        workZoneLng: -74.0,
        workZoneRadiusKm: 5,
        availability: {},
        specialties: [],
      };
      const dto = {
        displayName: 'María López',
        workZoneLat: 4.711,
        workZoneLng: -74.0721,
        workZoneRadiusKm: 10,
        specialties: ['homes', 'post-event'],
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockCleanerProfileRepository.findOne.mockResolvedValue(existingProfile);
      mockCleanerProfileRepository.save.mockResolvedValue({
        ...existingProfile,
        ...dto,
        availability: {},
      });

      const result = await service.saveCleanerProfile(keycloakId, dto);

      expect(result.displayName).toBe('María López');
      expect(result.workZoneLat).toBe(4.711);
      expect(result.specialties).toEqual(['homes', 'post-event']);
      expect(mockCleanerProfileRepository.create).not.toHaveBeenCalled();
    });

    it('should preserve existing optional fields when not provided in dto', async () => {
      const user = createMockUser();
      const existingProfile = {
        id: 'profile-uuid',
        userId: user.id,
        displayName: 'María',
        workZoneLat: 4.5,
        workZoneLng: -74.0,
        workZoneRadiusKm: 5,
        availability: { monday: ['08:00-17:00'] },
        specialties: ['airbnb'],
      };
      const dto = { displayName: 'María López Updated' };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockCleanerProfileRepository.findOne.mockResolvedValue(existingProfile);
      mockCleanerProfileRepository.save.mockImplementation((p) =>
        Promise.resolve(p),
      );

      const result = await service.saveCleanerProfile(keycloakId, dto);

      expect(result.displayName).toBe('María López Updated');
      expect(result.workZoneLat).toBe(4.5);
      expect(result.workZoneLng).toBe(-74.0);
      expect(result.workZoneRadiusKm).toBe(5);
      expect(result.availability).toEqual({ monday: ['08:00-17:00'] });
      expect(result.specialties).toEqual(['airbnb']);
    });

    it('should throw ForbiddenException when user does not have cleaner role', async () => {
      const user = createMockUser({ roles: [UserRole.HOST] });
      mockUserRepository.findOne.mockResolvedValue(user);

      await expect(
        service.saveCleanerProfile(keycloakId, { displayName: 'Test' }),
      ).rejects.toThrow(
        `Role '${UserRole.CLEANER}' is required to access this resource`,
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.saveCleanerProfile(keycloakId, { displayName: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOnboardingStatus', () => {
    const keycloakId = 'kc-onboard-001';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-onboard-1',
        keycloakId,
        email: 'onboard@example.com',
        fullName: 'Onboard User',
        country: 'US',
        language: 'en',
        isEmailVerified: true,
        roles: [UserRole.HOST, UserRole.CLEANER],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
        onboardingStatusCleaner: OnboardingStatus.IN_PROGRESS,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as User;

    it('should return onboarding status for user with host role only', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        onboardingStatusCleaner: OnboardingStatus.NOT_STARTED,
      });
      const hostProfile = {
        id: 'hp-1',
        userId: user.id,
        displayName: 'Host',
        isBusiness: false,
        businessName: null,
        paymentMethodAdded: false,
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockHostProfileRepository.findOne.mockResolvedValue(hostProfile);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.getOnboardingStatus(keycloakId);

      expect(result.host).not.toBeNull();
      expect(result.host!.status).toBe(OnboardingStatus.IN_PROGRESS);
      expect(result.host!.steps.displayNameConfirmed).toBe(true);
      expect(result.host!.steps.paymentMethodAdded).toBe(false);
      expect(result.cleaner).toBeNull();
    });

    it('should return onboarding status for user with cleaner role only', async () => {
      const user = createMockUser({
        roles: [UserRole.CLEANER],
        activeRole: UserRole.CLEANER,
        onboardingStatusHost: OnboardingStatus.NOT_STARTED,
      });
      const cleanerProfile = {
        id: 'cp-1',
        userId: user.id,
        displayName: 'Cleaner',
        workZoneLat: 4.5,
        workZoneLng: -74.0,
        workZoneRadiusKm: 10,
        availability: { monday: ['08:00-12:00'] },
        specialties: [],
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockCleanerProfileRepository.findOne.mockResolvedValue(cleanerProfile);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.getOnboardingStatus(keycloakId);

      expect(result.host).toBeNull();
      expect(result.cleaner).not.toBeNull();
      expect(result.cleaner!.steps.kycStarted).toBe(true);
      expect(result.cleaner!.steps.workZoneSet).toBe(true);
      expect(result.cleaner!.steps.availabilitySet).toBe(true);
    });

    it('should return onboarding status for user with both roles', async () => {
      const user = createMockUser();
      const hostProfile = {
        id: 'hp-1',
        userId: user.id,
        displayName: 'Host',
        isBusiness: false,
        businessName: null,
        paymentMethodAdded: false,
      };
      const cleanerProfile = {
        id: 'cp-1',
        userId: user.id,
        displayName: 'Cleaner',
        workZoneLat: null,
        workZoneLng: null,
        workZoneRadiusKm: null,
        availability: {},
        specialties: [],
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockHostProfileRepository.findOne.mockResolvedValue(hostProfile);
      mockCleanerProfileRepository.findOne.mockResolvedValue(cleanerProfile);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.getOnboardingStatus(keycloakId);

      expect(result.host).not.toBeNull();
      expect(result.cleaner).not.toBeNull();
      expect(result.host!.steps.displayNameConfirmed).toBe(true);
      expect(result.cleaner!.steps.kycStarted).toBe(true);
      expect(result.cleaner!.steps.workZoneSet).toBe(false);
      expect(result.cleaner!.steps.availabilitySet).toBe(false);
    });

    it('should return null for roles not assigned', async () => {
      const user = createMockUser({ roles: [] });
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.getOnboardingStatus(keycloakId);

      expect(result.host).toBeNull();
      expect(result.cleaner).toBeNull();
    });

    it('should mark host onboarding as COMPLETED when all steps are done', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
      });
      const hostProfile = {
        id: 'hp-1',
        userId: user.id,
        displayName: 'Host Complete',
        isBusiness: false,
        businessName: null,
        paymentMethodAdded: true,
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockHostProfileRepository.findOne.mockResolvedValue(hostProfile);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.getOnboardingStatus(keycloakId);

      expect(result.host!.status).toBe(OnboardingStatus.COMPLETED);
      expect(result.host!.steps.displayNameConfirmed).toBe(true);
      expect(result.host!.steps.paymentMethodAdded).toBe(true);
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          onboardingStatusHost: OnboardingStatus.COMPLETED,
        }),
      );
    });

    it('should mark cleaner onboarding as COMPLETED when all steps are done', async () => {
      const user = createMockUser({
        roles: [UserRole.CLEANER],
        activeRole: UserRole.CLEANER,
        onboardingStatusHost: OnboardingStatus.NOT_STARTED,
        onboardingStatusCleaner: OnboardingStatus.IN_PROGRESS,
      });
      const cleanerProfile = {
        id: 'cp-1',
        userId: user.id,
        displayName: 'Complete Cleaner',
        workZoneLat: 4.711,
        workZoneLng: -74.072,
        workZoneRadiusKm: 10,
        availability: { monday: ['08:00-17:00'] },
        specialties: ['airbnb'],
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockCleanerProfileRepository.findOne.mockResolvedValue(cleanerProfile);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.getOnboardingStatus(keycloakId);

      expect(result.cleaner!.status).toBe(OnboardingStatus.COMPLETED);
      expect(result.cleaner!.steps.kycStarted).toBe(true);
      expect(result.cleaner!.steps.workZoneSet).toBe(true);
      expect(result.cleaner!.steps.availabilitySet).toBe(true);
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          onboardingStatusCleaner: OnboardingStatus.COMPLETED,
        }),
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getOnboardingStatus(keycloakId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addSecondRole', () => {
    const keycloakId = 'kc-dual-001';

    const createMockUser = (overrides: Partial<User> = {}): User =>
      ({
        id: 'uuid-dual-1',
        keycloakId,
        email: 'dual@example.com',
        fullName: 'Dual User',
        country: 'CO',
        language: 'es',
        isEmailVerified: true,
        roles: [],
        activeRole: null,
        onboardingStatusHost: OnboardingStatus.NOT_STARTED,
        onboardingStatusCleaner: OnboardingStatus.NOT_STARTED,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as User;

    it('should add CLEANER without affecting HOST when user initially has HOST only', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.IN_PROGRESS,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.assignRoles(keycloakId, {
        roles: [UserRole.HOST, UserRole.CLEANER],
      });

      expect(result.roles).toContain(UserRole.HOST);
      expect(result.roles).toContain(UserRole.CLEANER);
      expect(result.roles).toHaveLength(2);
      expect(user.onboardingStatusHost).toBe(OnboardingStatus.IN_PROGRESS);
      expect(user.onboardingStatusCleaner).toBe(OnboardingStatus.IN_PROGRESS);
    });

    it('should add HOST without affecting CLEANER when user initially has CLEANER only', async () => {
      const user = createMockUser({
        roles: [UserRole.CLEANER],
        activeRole: UserRole.CLEANER,
        onboardingStatusCleaner: OnboardingStatus.IN_PROGRESS,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.assignRoles(keycloakId, {
        roles: [UserRole.HOST, UserRole.CLEANER],
      });

      expect(result.roles).toContain(UserRole.HOST);
      expect(result.roles).toContain(UserRole.CLEANER);
      expect(result.roles).toHaveLength(2);
      expect(user.onboardingStatusCleaner).toBe(OnboardingStatus.IN_PROGRESS);
      expect(user.onboardingStatusHost).toBe(OnboardingStatus.IN_PROGRESS);
    });

    it('should keep active role unchanged when adding a second role', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.COMPLETED,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.assignRoles(keycloakId, {
        roles: [UserRole.CLEANER],
      });

      expect(result.activeRole).toBe(UserRole.HOST);
      expect(user.activeRole).toBe(UserRole.HOST);
    });

    it('should keep existing role onboarding status unchanged and set new role to IN_PROGRESS', async () => {
      const user = createMockUser({
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
        onboardingStatusHost: OnboardingStatus.COMPLETED,
      });
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue(user);

      await service.assignRoles(keycloakId, {
        roles: [UserRole.CLEANER],
      });

      expect(user.onboardingStatusHost).toBe(OnboardingStatus.COMPLETED);
      expect(user.onboardingStatusCleaner).toBe(OnboardingStatus.IN_PROGRESS);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProfileController } from '../profile.controller';
import { ProfileService } from '../profile.service';
import { ProfilePhotoService } from '../photo/profile-photo.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { SettingsService } from '../settings/settings.service';
import { AccountService } from '../account/account.service';
import { CompletenessService } from '../completeness/completeness.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { UserSettings } from '../entities/user-settings.entity';
import { UserSettingsResponse } from '../settings/settings.types';
import { UpdateSettingsDto } from '../dto/update-settings.dto';
import { User } from '../../auth/entities/user.entity';

describe('ProfileController — Settings Endpoints', () => {
  let controller: ProfileController;
  let profileService: jest.Mocked<Partial<ProfileService>>;
  let settingsService: jest.Mocked<Partial<SettingsService>>;

  const mockKeycloakId = 'kc-user-settings-123';
  const mockUserId = 'internal-user-settings-456';

  const mockJwtPayload: JwtUserPayload = {
    keycloakId: mockKeycloakId,
    email: 'user@example.com',
    emailVerified: true,
  };

  const mockSettings: UserSettings = {
    id: 'settings-uuid-1',
    userId: mockUserId,
    language: 'en',
    theme: 'system',
    isPushEnabled: true,
    isEmailNotificationsEnabled: true,
    isSoundsEnabled: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const expectedResponse: UserSettingsResponse = {
    language: 'en',
    theme: 'system',
    isPushEnabled: true,
    isEmailNotificationsEnabled: true,
    isSoundsEnabled: true,
  };

  const createMockReq = () =>
    ({ user: mockJwtPayload }) as any;

  beforeEach(async () => {
    profileService = {
      findUserIdByKeycloakId: jest.fn().mockResolvedValue(mockUserId),
      findUserWithRole: jest.fn(),
      getPrivateProfile: jest.fn(),
      updateCommonProfile: jest.fn(),
      updateHostProfile: jest.fn(),
      updateCleanerProfile: jest.fn(),
    };

    settingsService = {
      getSettings: jest.fn().mockResolvedValue(mockSettings),
      updateSettings: jest.fn().mockResolvedValue(mockSettings),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        { provide: ProfileService, useValue: profileService },
        { provide: ProfilePhotoService, useValue: {} },
        { provide: PortfolioService, useValue: {} },
        { provide: SettingsService, useValue: settingsService },
        { provide: AccountService, useValue: {} },
        { provide: CompletenessService, useValue: {} },
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: {} },
      ],
    }).compile();

    controller = module.get<ProfileController>(ProfileController);
  });

  describe('GET /profile/me/settings', () => {
    it('should return user settings excluding internal fields', async () => {
      const req = createMockReq();

      const result = await controller.getSettings(req);

      expect(result).toEqual(expectedResponse);
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('userId');
      expect(result).not.toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('updatedAt');
    });

    it('should resolve userId from keycloakId before fetching settings', async () => {
      const req = createMockReq();

      await controller.getSettings(req);

      expect(profileService.findUserIdByKeycloakId).toHaveBeenCalledWith(
        mockKeycloakId,
      );
      expect(settingsService.getSettings).toHaveBeenCalledWith(mockUserId);
    });

    it('should return default settings when user has no existing settings', async () => {
      const defaultSettings: UserSettings = {
        ...mockSettings,
        language: 'en',
        theme: 'system',
        isPushEnabled: true,
        isEmailNotificationsEnabled: true,
        isSoundsEnabled: true,
      };
      settingsService.getSettings = jest.fn().mockResolvedValue(defaultSettings);

      const req = createMockReq();
      const result = await controller.getSettings(req);

      expect(result.language).toBe('en');
      expect(result.theme).toBe('system');
      expect(result.isPushEnabled).toBe(true);
    });

    it('should propagate errors from profileService.findUserIdByKeycloakId', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      profileService.findUserIdByKeycloakId = jest
        .fn()
        .mockRejectedValue(new NotFoundException('profile.error.user_not_found'));

      const req = createMockReq();

      await expect(controller.getSettings(req)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should have JwtAuthGuard applied', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        ProfileController.prototype.getSettings,
      );

      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
    });
  });

  describe('PATCH /profile/me/settings', () => {
    it('should update settings and return response without internal fields', async () => {
      const updatedSettings: UserSettings = {
        ...mockSettings,
        language: 'es',
        theme: 'dark',
      };
      settingsService.updateSettings = jest
        .fn()
        .mockResolvedValue(updatedSettings);

      const req = createMockReq();
      const dto: UpdateSettingsDto = { language: 'es', theme: 'dark' };

      const result = await controller.updateSettings(req, dto);

      expect(result.language).toBe('es');
      expect(result.theme).toBe('dark');
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('userId');
    });

    it('should resolve userId and delegate to settingsService.updateSettings', async () => {
      const req = createMockReq();
      const dto: UpdateSettingsDto = { isPushEnabled: false };

      await controller.updateSettings(req, dto);

      expect(profileService.findUserIdByKeycloakId).toHaveBeenCalledWith(
        mockKeycloakId,
      );
      expect(settingsService.updateSettings).toHaveBeenCalledWith(
        mockUserId,
        dto,
      );
    });

    it('should support partial updates (only one field)', async () => {
      const partiallyUpdated: UserSettings = {
        ...mockSettings,
        isSoundsEnabled: false,
      };
      settingsService.updateSettings = jest
        .fn()
        .mockResolvedValue(partiallyUpdated);

      const req = createMockReq();
      const dto: UpdateSettingsDto = { isSoundsEnabled: false };

      const result = await controller.updateSettings(req, dto);

      expect(result.isSoundsEnabled).toBe(false);
      expect(result.language).toBe('en');
      expect(result.theme).toBe('system');
      expect(result.isPushEnabled).toBe(true);
    });

    it('should propagate BadRequestException from settingsService', async () => {
      settingsService.updateSettings = jest
        .fn()
        .mockRejectedValue(
          new BadRequestException('profile.error.invalid_settings'),
        );

      const req = createMockReq();
      const dto: UpdateSettingsDto = { language: 'invalid' };

      await expect(controller.updateSettings(req, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should have JwtAuthGuard applied', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        ProfileController.prototype.updateSettings,
      );

      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
    });

    it('should propagate user not found error from profileService', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      profileService.findUserIdByKeycloakId = jest
        .fn()
        .mockRejectedValue(new NotFoundException('profile.error.user_not_found'));

      const req = createMockReq();
      const dto: UpdateSettingsDto = { theme: 'dark' };

      await expect(controller.updateSettings(req, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

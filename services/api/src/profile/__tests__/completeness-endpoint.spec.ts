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
import { ProfileCompleteness } from '../profile.types';
import { User } from '../../auth/entities/user.entity';

describe('ProfileController — GET /profile/me/completeness', () => {
  let controller: ProfileController;
  let profileService: jest.Mocked<Partial<ProfileService>>;
  let completenessService: jest.Mocked<Partial<CompletenessService>>;

  const mockKeycloakId = 'kc-user-abc-123';
  const mockUserId = 'internal-user-456';

  const mockCompletenessResult: ProfileCompleteness = {
    percentage: 60,
    role: 'cleaner',
    fields: [
      { name: 'name', completed: true, weight: 15 },
      { name: 'photo', completed: true, weight: 15 },
      { name: 'specialties', completed: true, weight: 15 },
      { name: 'work_zone', completed: false, weight: 15 },
      { name: 'availability', completed: true, weight: 10 },
      { name: 'portfolio', completed: false, weight: 10 },
      { name: 'kyc', completed: false, weight: 10 },
      { name: 'bio', completed: true, weight: 10 },
    ],
  };

  const mockJwtPayload: JwtUserPayload = {
    keycloakId: mockKeycloakId,
    email: 'user@example.com',
    emailVerified: true,
  };

  const createMockReq = () =>
    ({ user: mockJwtPayload }) as any;

  beforeEach(async () => {
    profileService = {
      findUserIdByKeycloakId: jest.fn().mockResolvedValue(mockUserId),
      findUserWithRole: jest.fn().mockResolvedValue({
        id: mockUserId,
        activeRole: 'cleaner',
      }),
      getPrivateProfile: jest.fn(),
      updateCommonProfile: jest.fn(),
      updateHostProfile: jest.fn(),
      updateCleanerProfile: jest.fn(),
    };

    completenessService = {
      calculateCompleteness: jest.fn().mockResolvedValue(mockCompletenessResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        { provide: ProfileService, useValue: profileService },
        { provide: ProfilePhotoService, useValue: {} },
        { provide: PortfolioService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: AccountService, useValue: {} },
        { provide: CompletenessService, useValue: completenessService },
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: {} },
      ],
    }).compile();

    controller = module.get<ProfileController>(ProfileController);
  });

  describe('successful completeness retrieval', () => {
    it('should return completeness data with percentage and fields breakdown', async () => {
      const req = createMockReq();

      const result = await controller.getCompleteness(req);

      expect(result).toEqual(mockCompletenessResult);
      expect(result.percentage).toBe(60);
      expect(result.role).toBe('cleaner');
      expect(result.fields).toHaveLength(8);
    });

    it('should call profileService.findUserWithRole with keycloakId', async () => {
      const req = createMockReq();

      await controller.getCompleteness(req);

      expect(profileService.findUserWithRole).toHaveBeenCalledWith(mockKeycloakId);
    });

    it('should call completenessService.calculateCompleteness with correct params', async () => {
      const req = createMockReq();

      await controller.getCompleteness(req);

      expect(completenessService.calculateCompleteness).toHaveBeenCalledWith(
        mockUserId,
        'cleaner',
      );
    });

    it('should work for host role', async () => {
      const hostCompleteness: ProfileCompleteness = {
        percentage: 40,
        role: 'host',
        fields: [
          { name: 'name', completed: true, weight: 20 },
          { name: 'photo', completed: true, weight: 20 },
          { name: 'business_name', completed: false, weight: 20 },
          { name: 'payment_method', completed: false, weight: 20 },
          { name: 'first_property', completed: false, weight: 20 },
        ],
      };

      profileService.findUserWithRole = jest.fn().mockResolvedValue({
        id: mockUserId,
        activeRole: 'host',
      });
      completenessService.calculateCompleteness = jest
        .fn()
        .mockResolvedValue(hostCompleteness);

      const req = createMockReq();
      const result = await controller.getCompleteness(req);

      expect(completenessService.calculateCompleteness).toHaveBeenCalledWith(
        mockUserId,
        'host',
      );
      expect(result.percentage).toBe(40);
      expect(result.role).toBe('host');
    });
  });

  describe('error handling', () => {
    it('should throw BadRequestException when active role is not set', async () => {
      profileService.findUserWithRole = jest.fn().mockResolvedValue({
        id: mockUserId,
        activeRole: null,
      });

      const req = createMockReq();

      await expect(controller.getCompleteness(req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException with correct i18n key when no active role', async () => {
      profileService.findUserWithRole = jest.fn().mockResolvedValue({
        id: mockUserId,
        activeRole: null,
      });

      const req = createMockReq();

      await expect(controller.getCompleteness(req)).rejects.toThrow(
        'profile.error.no_active_role',
      );
    });

    it('should propagate errors from profileService.findUserWithRole', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      profileService.findUserWithRole = jest
        .fn()
        .mockRejectedValue(new NotFoundException('profile.error.user_not_found'));

      const req = createMockReq();

      await expect(controller.getCompleteness(req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('authentication guard', () => {
    it('should have JwtAuthGuard applied to getCompleteness', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        ProfileController.prototype.getCompleteness,
      );

      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
    });
  });
});

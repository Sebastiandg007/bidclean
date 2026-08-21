import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProfileController } from '../profile.controller';
import { ProfileService } from '../profile.service';
import { ProfilePhotoService } from '../photo/profile-photo.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { SettingsService } from '../settings/settings.service';
import { AccountService } from '../account/account.service';
import { CompletenessService } from '../completeness/completeness.service';
import { OnboardingGateGuard } from '../../roles/guards/onboarding-gate.guard';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { PrivateProfile } from '../profile.types';
import { User } from '../../auth/entities/user.entity';

describe('ProfileController — DELETE /profile/me/photo', () => {
  let controller: ProfileController;
  let profileService: jest.Mocked<Partial<ProfileService>>;
  let profilePhotoService: jest.Mocked<Partial<ProfilePhotoService>>;

  const mockKeycloakId = 'kc-user-abc-123';
  const mockUserId = 'internal-user-456';

  const mockPrivateProfileWithoutPhoto: PrivateProfile = {
    id: 'profile-id-789',
    userId: mockUserId,
    email: 'test@example.com',
    displayName: 'Test User',
    phoneNumber: null,
    photoUrl: null,
    bio: null,
    activeRole: 'host',
    roles: ['host'],
    hostProfile: null,
    cleanerProfile: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-06-01'),
  };

  const mockJwtPayload: JwtUserPayload = {
    keycloakId: mockKeycloakId,
    email: 'test@example.com',
    emailVerified: true,
  };

  const createMockReq = (): any => ({ user: mockJwtPayload });

  beforeEach(async () => {
    profileService = {
      findUserIdByKeycloakId: jest.fn().mockResolvedValue(mockUserId),
      getPrivateProfile: jest.fn().mockResolvedValue(mockPrivateProfileWithoutPhoto),
      updateCommonProfile: jest.fn(),
      updateHostProfile: jest.fn(),
      updateCleanerProfile: jest.fn(),
    };

    profilePhotoService = {
      deletePhoto: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        { provide: ProfileService, useValue: profileService },
        { provide: ProfilePhotoService, useValue: profilePhotoService },
        { provide: PortfolioService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: AccountService, useValue: {} },
        { provide: CompletenessService, useValue: {} },
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: {} },
        OnboardingGateGuard,
      ],
    }).compile();

    controller = module.get<ProfileController>(ProfileController);
  });

  it('should resolve userId from keycloakId, delete photo, and return updated profile', async () => {
    const req = createMockReq();

    const result = await controller.deletePhoto(req);

    expect(profileService.findUserIdByKeycloakId).toHaveBeenCalledWith(mockKeycloakId);
    expect(profilePhotoService.deletePhoto).toHaveBeenCalledWith(mockUserId);
    expect(profileService.getPrivateProfile).toHaveBeenCalledWith(mockKeycloakId);
    expect(result).toEqual(mockPrivateProfileWithoutPhoto);
  });

  it('should return profile with null photoUrl after deletion', async () => {
    const req = createMockReq();

    const result = await controller.deletePhoto(req);

    expect(result.photoUrl).toBeNull();
  });

  it('should succeed idempotently when no photo exists', async () => {
    const req = createMockReq();

    profilePhotoService.deletePhoto = jest.fn().mockResolvedValue(undefined);

    const result = await controller.deletePhoto(req);

    expect(profilePhotoService.deletePhoto).toHaveBeenCalledWith(mockUserId);
    expect(result).toEqual(mockPrivateProfileWithoutPhoto);
  });

  it('should propagate errors from profilePhotoService.deletePhoto', async () => {
    const req = createMockReq();

    profilePhotoService.deletePhoto = jest
      .fn()
      .mockRejectedValue(new Error('MinIO connection failed'));

    await expect(controller.deletePhoto(req)).rejects.toThrow(
      'MinIO connection failed',
    );
  });

  it('should propagate NotFoundException from findUserIdByKeycloakId', async () => {
    const req = createMockReq();
    const { NotFoundException } = await import('@nestjs/common');

    profileService.findUserIdByKeycloakId = jest
      .fn()
      .mockRejectedValue(new NotFoundException('profile.error.user_not_found'));

    await expect(controller.deletePhoto(req)).rejects.toThrow(NotFoundException);
  });

  it('should have JwtAuthGuard applied via UseGuards decorator', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      ProfileController.prototype.deletePhoto,
    );

    expect(guards).toBeDefined();
    expect(guards.length).toBeGreaterThanOrEqual(1);
  });
});

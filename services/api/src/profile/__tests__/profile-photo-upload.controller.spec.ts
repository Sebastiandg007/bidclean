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
import { OnboardingGateGuard } from '../../roles/guards/onboarding-gate.guard';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { PrivateProfile } from '../profile.types';
import { User } from '../../auth/entities/user.entity';

describe('ProfileController — POST /profile/me/photo', () => {
  let controller: ProfileController;
  let profileService: jest.Mocked<Partial<ProfileService>>;
  let profilePhotoService: jest.Mocked<Partial<ProfilePhotoService>>;

  const mockKeycloakId = 'kc-user-abc-123';
  const mockUserId = 'internal-user-456';

  const mockPrivateProfile: PrivateProfile = {
    id: 'profile-id-789',
    userId: mockUserId,
    email: 'test@example.com',
    displayName: 'Test User',
    phoneNumber: null,
    photoUrl: 'https://minio.local/signed-url',
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

  const createMockReq = () =>
    ({ user: mockJwtPayload }) as any;

  const createMockFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake-image-data'),
      mimetype: 'image/jpeg',
      originalname: 'photo.jpg',
      fieldname: 'file',
      size: 1024,
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(async () => {
    profileService = {
      findUserIdByKeycloakId: jest.fn().mockResolvedValue(mockUserId),
      getPrivateProfile: jest.fn().mockResolvedValue(mockPrivateProfile),
      updateCommonProfile: jest.fn(),
      updateHostProfile: jest.fn(),
      updateCleanerProfile: jest.fn(),
    };

    profilePhotoService = {
      uploadPhoto: jest.fn().mockResolvedValue(`${mockUserId}/avatar.jpg`),
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

  it('should upload photo and return updated private profile', async () => {
    const mockFile = createMockFile();
    const req = createMockReq();

    const result = await controller.uploadPhoto(req, mockFile);

    expect(profileService.findUserIdByKeycloakId).toHaveBeenCalledWith(
      mockKeycloakId,
    );
    expect(profilePhotoService.uploadPhoto).toHaveBeenCalledWith(
      mockUserId,
      mockFile.buffer,
      'image/jpeg',
    );
    expect(profileService.getPrivateProfile).toHaveBeenCalledWith(
      mockKeycloakId,
    );
    expect(result).toEqual(mockPrivateProfile);
  });

  it('should throw BadRequestException when no file is provided', async () => {
    const req = createMockReq();

    await expect(
      controller.uploadPhoto(req, undefined as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should propagate errors from profilePhotoService.uploadPhoto', async () => {
    const mockFile = createMockFile({ mimetype: 'image/gif' });
    const req = createMockReq();

    profilePhotoService.uploadPhoto = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException('profile.error.unsupported_image_format'),
      );

    await expect(controller.uploadPhoto(req, mockFile)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should call uploadPhoto with PNG mimetype correctly', async () => {
    const mockFile = createMockFile({
      buffer: Buffer.from('png-data'),
      mimetype: 'image/png',
      originalname: 'photo.png',
    });
    const req = createMockReq();

    await controller.uploadPhoto(req, mockFile);

    expect(profilePhotoService.uploadPhoto).toHaveBeenCalledWith(
      mockUserId,
      mockFile.buffer,
      'image/png',
    );
  });

  it('should call uploadPhoto with WebP mimetype correctly', async () => {
    const mockFile = createMockFile({
      buffer: Buffer.from('webp-data'),
      mimetype: 'image/webp',
      originalname: 'photo.webp',
    });
    const req = createMockReq();

    await controller.uploadPhoto(req, mockFile);

    expect(profilePhotoService.uploadPhoto).toHaveBeenCalledWith(
      mockUserId,
      mockFile.buffer,
      'image/webp',
    );
  });
});

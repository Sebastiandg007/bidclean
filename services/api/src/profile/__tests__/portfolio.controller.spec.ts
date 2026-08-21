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
import { PortfolioUploadResult } from '../portfolio/portfolio.types';
import { User } from '../../auth/entities/user.entity';

describe('ProfileController — Portfolio endpoints', () => {
  let controller: ProfileController;
  let profileService: jest.Mocked<Partial<ProfileService>>;
  let portfolioService: jest.Mocked<Partial<PortfolioService>>;

  const mockKeycloakId = 'kc-cleaner-abc-123';
  const mockUserId = 'internal-cleaner-456';
  const mockPhotoId = 'photo-uuid-789';

  const mockUploadResult: PortfolioUploadResult = {
    id: mockPhotoId,
    url: 'https://minio.local/signed-portfolio-url',
    displayOrder: 0,
    caption: 'Kitchen cleaning result',
    createdAt: new Date('2024-06-01'),
  };

  const mockJwtPayload: JwtUserPayload = {
    keycloakId: mockKeycloakId,
    email: 'cleaner@example.com',
    emailVerified: true,
  };

  const createMockReq = () =>
    ({ user: mockJwtPayload }) as any;

  const createMockFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake-portfolio-image'),
      mimetype: 'image/jpeg',
      originalname: 'portfolio-photo.jpg',
      fieldname: 'file',
      size: 2048,
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(async () => {
    profileService = {
      findUserIdByKeycloakId: jest.fn().mockResolvedValue(mockUserId),
      getPrivateProfile: jest.fn(),
      updateCommonProfile: jest.fn(),
      updateHostProfile: jest.fn(),
      updateCleanerProfile: jest.fn(),
    };

    portfolioService = {
      uploadPhoto: jest.fn().mockResolvedValue(mockUploadResult),
      deletePhoto: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        { provide: ProfileService, useValue: profileService },
        { provide: ProfilePhotoService, useValue: {} },
        { provide: PortfolioService, useValue: portfolioService },
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

  describe('POST /profile/me/portfolio', () => {
    it('should upload portfolio photo and return upload result', async () => {
      const mockFile = createMockFile();
      const req = createMockReq();
      const dto = { caption: 'Kitchen cleaning result' };

      const result = await controller.uploadPortfolioPhoto(req, mockFile, dto);

      expect(profileService.findUserIdByKeycloakId).toHaveBeenCalledWith(
        mockKeycloakId,
      );
      expect(portfolioService.uploadPhoto).toHaveBeenCalledWith(
        mockUserId,
        mockFile.buffer,
        'image/jpeg',
        'Kitchen cleaning result',
      );
      expect(result).toEqual(mockUploadResult);
    });

    it('should upload portfolio photo without caption', async () => {
      const mockFile = createMockFile();
      const req = createMockReq();
      const dto = {};

      await controller.uploadPortfolioPhoto(req, mockFile, dto);

      expect(portfolioService.uploadPhoto).toHaveBeenCalledWith(
        mockUserId,
        mockFile.buffer,
        'image/jpeg',
        undefined,
      );
    });

    it('should throw BadRequestException when no file is provided', async () => {
      const req = createMockReq();
      const dto = { caption: 'Test' };

      await expect(
        controller.uploadPortfolioPhoto(req, undefined as any, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate errors from portfolioService.uploadPhoto', async () => {
      const mockFile = createMockFile();
      const req = createMockReq();
      const dto = {};

      portfolioService.uploadPhoto = jest
        .fn()
        .mockRejectedValue(
          new BadRequestException('profile.error.portfolio_max'),
        );

      await expect(
        controller.uploadPortfolioPhoto(req, mockFile, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should call uploadPhoto with PNG mimetype correctly', async () => {
      const mockFile = createMockFile({
        buffer: Buffer.from('png-data'),
        mimetype: 'image/png',
        originalname: 'portfolio.png',
      });
      const req = createMockReq();
      const dto = {};

      await controller.uploadPortfolioPhoto(req, mockFile, dto);

      expect(portfolioService.uploadPhoto).toHaveBeenCalledWith(
        mockUserId,
        mockFile.buffer,
        'image/png',
        undefined,
      );
    });
  });

  describe('DELETE /profile/me/portfolio/:photoId', () => {
    it('should delete portfolio photo and return void', async () => {
      const req = createMockReq();

      await controller.deletePortfolioPhoto(req, mockPhotoId);

      expect(profileService.findUserIdByKeycloakId).toHaveBeenCalledWith(
        mockKeycloakId,
      );
      expect(portfolioService.deletePhoto).toHaveBeenCalledWith(
        mockUserId,
        mockPhotoId,
      );
    });

    it('should propagate NotFoundException from portfolioService.deletePhoto', async () => {
      const req = createMockReq();
      const { NotFoundException } = await import('@nestjs/common');

      portfolioService.deletePhoto = jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('profile.error.photo_not_found'),
        );

      await expect(
        controller.deletePortfolioPhoto(req, mockPhotoId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ProfilePhotoService } from '../photo/profile-photo.service';
import { ProfileRepository } from '../profile.repository';

// Mock sharp
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('resized-image')),
  }));
  return { __esModule: true, default: mockSharp };
});

// Mock minio
const mockPutObject = jest.fn().mockResolvedValue({ etag: 'mock-etag' });
const mockRemoveObject = jest.fn().mockResolvedValue(undefined);
const mockPresignedGetObject = jest.fn().mockResolvedValue('https://minio.local/signed-url');
const mockBucketExists = jest.fn().mockResolvedValue(true);
const mockMakeBucket = jest.fn().mockResolvedValue(undefined);

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    removeObject: mockRemoveObject,
    presignedGetObject: mockPresignedGetObject,
    bucketExists: mockBucketExists,
    makeBucket: mockMakeBucket,
  })),
}));

describe('ProfilePhotoService', () => {
  let service: ProfilePhotoService;
  let profileRepository: jest.Mocked<ProfileRepository>;

  const mockConfigValues: Record<string, string> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ROOT_USER: 'testuser',
    MINIO_ROOT_PASSWORD: 'testpassword',
    MINIO_PROFILE_PHOTOS_BUCKET: 'profile-photos',
    PROFILE_PHOTO_MAX_SIZE_MB: '5',
    PROFILE_PHOTO_MAX_DIMENSION_PX: '1024',
    PROFILE_PHOTO_URL_EXPIRY_SECONDS: '3600',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockProfileRepository = {
      findByUserId: jest.fn().mockResolvedValue(null),
      findByUserIdOrFail: jest.fn().mockResolvedValue({
        userId: 'user-123',
        photoStorageKey: null,
      }),
      updateProfile: jest.fn().mockResolvedValue({
        userId: 'user-123',
        photoStorageKey: 'user-123/avatar.jpg',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilePhotoService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfigValues[key];
              if (!value) throw new Error(`Missing config: ${key}`);
              return value;
            }),
          },
        },
        {
          provide: ProfileRepository,
          useValue: mockProfileRepository,
        },
      ],
    }).compile();

    service = module.get<ProfilePhotoService>(ProfilePhotoService);
    profileRepository = module.get(ProfileRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should create bucket if it does not exist', async () => {
      mockBucketExists.mockResolvedValueOnce(false);
      await service.onModuleInit();
      expect(mockBucketExists).toHaveBeenCalledWith('profile-photos');
      expect(mockMakeBucket).toHaveBeenCalledWith('profile-photos');
    });

    it('should not create bucket if it already exists', async () => {
      mockBucketExists.mockResolvedValueOnce(true);
      await service.onModuleInit();
      expect(mockBucketExists).toHaveBeenCalledWith('profile-photos');
      expect(mockMakeBucket).not.toHaveBeenCalled();
    });
  });

  describe('uploadPhoto', () => {
    const userId = 'user-123';
    const file = Buffer.from('fake-image-data');
    const mimeType = 'image/jpeg';

    it('should resize, upload to MinIO with encryption, and return storage key', async () => {
      const result = await service.uploadPhoto(userId, file, mimeType);

      expect(result).toBe('user-123/avatar.jpg');
      expect(mockPutObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/avatar.jpg',
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          'Content-Type': 'image/jpeg',
          'x-amz-server-side-encryption': 'AES256',
        }),
      );
      expect(profileRepository.updateProfile).toHaveBeenCalledWith(userId, {
        photoStorageKey: 'user-123/avatar.jpg',
      });
    });

    it('should delete old photo if one exists before uploading new one', async () => {
      profileRepository.findByUserId = jest.fn().mockResolvedValue({
        userId,
        photoStorageKey: 'user-123/avatar.png',
      });

      await service.uploadPhoto(userId, file, mimeType);

      expect(mockRemoveObject).toHaveBeenCalledWith('profile-photos', 'user-123/avatar.png');
      expect(mockPutObject).toHaveBeenCalled();
    });

    it('should not attempt to delete when no previous photo exists', async () => {
      profileRepository.findByUserId = jest.fn().mockResolvedValue(null);

      await service.uploadPhoto(userId, file, mimeType);

      expect(mockRemoveObject).not.toHaveBeenCalled();
      expect(mockPutObject).toHaveBeenCalled();
    });

    it('should reject unsupported MIME types with BadRequestException', async () => {
      await expect(
        service.uploadPhoto(userId, file, 'image/gif'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject application/pdf MIME type', async () => {
      await expect(
        service.uploadPhoto(userId, file, 'application/pdf'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject files exceeding max size with PayloadTooLargeException', async () => {
      const largeFile = Buffer.alloc(6 * 1024 * 1024); // 6MB exceeds configured 5MB limit

      await expect(
        service.uploadPhoto(userId, largeFile, mimeType),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('should accept PNG files and use correct extension', async () => {
      const result = await service.uploadPhoto(userId, file, 'image/png');
      expect(result).toBe('user-123/avatar.png');
    });

    it('should accept WebP files and use correct extension', async () => {
      const result = await service.uploadPhoto(userId, file, 'image/webp');
      expect(result).toBe('user-123/avatar.webp');
    });

    it('should accept files exactly at max size', async () => {
      const maxFile = Buffer.alloc(5 * 1024 * 1024); // exactly at configured max

      await expect(
        service.uploadPhoto(userId, maxFile, mimeType),
      ).resolves.toBe('user-123/avatar.jpg');
    });
  });

  describe('deletePhoto', () => {
    const userId = 'user-123';

    it('should remove photo from MinIO and clear storage key', async () => {
      profileRepository.findByUserIdOrFail = jest.fn().mockResolvedValue({
        userId,
        photoStorageKey: 'user-123/avatar.jpg',
      });

      await service.deletePhoto(userId);

      expect(mockRemoveObject).toHaveBeenCalledWith('profile-photos', 'user-123/avatar.jpg');
      expect(profileRepository.updateProfile).toHaveBeenCalledWith(userId, {
        photoStorageKey: null,
      });
    });

    it('should not call MinIO when no photo exists', async () => {
      profileRepository.findByUserIdOrFail = jest.fn().mockResolvedValue({
        userId,
        photoStorageKey: null,
      });

      await service.deletePhoto(userId);

      expect(mockRemoveObject).not.toHaveBeenCalled();
      expect(profileRepository.updateProfile).not.toHaveBeenCalled();
    });

    it('should be idempotent when object already deleted in MinIO', async () => {
      profileRepository.findByUserIdOrFail = jest.fn().mockResolvedValue({
        userId,
        photoStorageKey: 'user-123/avatar.jpg',
      });

      mockRemoveObject.mockRejectedValueOnce({ code: 'NoSuchKey' });

      await expect(service.deletePhoto(userId)).resolves.toBeUndefined();
      expect(profileRepository.updateProfile).toHaveBeenCalledWith(userId, {
        photoStorageKey: null,
      });
    });
  });

  describe('getSignedUrl', () => {
    it('should return signed URL with correct expiry date', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const result = await service.getSignedUrl('user-123/avatar.jpg');

      expect(mockPresignedGetObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/avatar.jpg',
        3600,
      );
      expect(result.url).toBe('https://minio.local/signed-url');
      expect(result.expiresAt).toEqual(new Date(now + 3600 * 1000));

      jest.spyOn(Date, 'now').mockRestore();
    });
  });
});

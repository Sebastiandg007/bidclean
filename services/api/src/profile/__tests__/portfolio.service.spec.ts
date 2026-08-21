import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  PayloadTooLargeException,
  NotFoundException,
} from '@nestjs/common';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PortfolioPhoto } from '../entities/portfolio-photo.entity';

// Mock sharp
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('resized-image')),
  }));
  return { __esModule: true, default: mockSharp };
});

// Mock crypto.randomUUID
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
}));

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

describe('PortfolioService', () => {
  let service: PortfolioService;
  let portfolioPhotoRepo: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const mockConfigValues: Record<string, string> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ROOT_USER: 'testuser',
    MINIO_ROOT_PASSWORD: 'testpassword',
    MINIO_PROFILE_PHOTOS_BUCKET: 'profile-photos',
    PROFILE_PHOTO_MAX_SIZE_MB: '5',
    PROFILE_PHOTO_MAX_DIMENSION_PX: '1024',
    PROFILE_MAX_PORTFOLIO_PHOTOS: '20',
    PROFILE_PHOTO_URL_EXPIRY_SECONDS: '3600',
  };

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ maxOrder: null }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    portfolioPhotoRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => ({
        id: 'photo-id-123',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        ...data,
      })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: getRepositoryToken(PortfolioPhoto),
          useValue: portfolioPhotoRepo,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfigValues[key];
              if (!value) throw new Error(`Missing config: ${key}`);
              return value;
            }),
            get: jest.fn((key: string, defaultValue?: string) => {
              return mockConfigValues[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
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

    it('should resize, upload to MinIO with encryption, save to DB, and return result', async () => {
      const result = await service.uploadPhoto(userId, file, mimeType);

      expect(result.id).toBe('photo-id-123');
      expect(result.url).toBe('https://minio.local/signed-url');
      expect(result.displayOrder).toBe(0);
      expect(result.caption).toBeNull();

      expect(mockPutObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/portfolio/mock-uuid-1234.jpg',
        expect.any(Buffer),
        expect.any(Number),
        expect.objectContaining({
          'Content-Type': 'image/jpeg',
          'x-amz-server-side-encryption': 'AES256',
        }),
      );

      expect(portfolioPhotoRepo.create).toHaveBeenCalledWith({
        userId,
        storageKey: 'user-123/portfolio/mock-uuid-1234.jpg',
        displayOrder: 0,
        caption: null,
      });
      expect(portfolioPhotoRepo.save).toHaveBeenCalled();
    });

    it('should save caption when provided', async () => {
      const result = await service.uploadPhoto(userId, file, mimeType, 'Before cleaning');

      expect(result.caption).toBe('Before cleaning');
      expect(portfolioPhotoRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ caption: 'Before cleaning' }),
      );
    });

    it('should assign next display_order based on max existing', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValueOnce({ maxOrder: 3 });

      const result = await service.uploadPhoto(userId, file, mimeType);

      expect(result.displayOrder).toBe(4);
    });

    it('should reject unsupported MIME types with BadRequestException', async () => {
      await expect(
        service.uploadPhoto(userId, file, 'image/gif'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject files exceeding max size with PayloadTooLargeException', async () => {
      const largeFile = Buffer.alloc(6 * 1024 * 1024); // 6MB exceeds 5MB limit

      await expect(
        service.uploadPhoto(userId, largeFile, mimeType),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('should reject when max portfolio photo count reached', async () => {
      portfolioPhotoRepo.count.mockResolvedValueOnce(20);

      await expect(
        service.uploadPhoto(userId, file, mimeType),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use correct extension for PNG', async () => {
      await service.uploadPhoto(userId, file, 'image/png');

      expect(mockPutObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/portfolio/mock-uuid-1234.png',
        expect.any(Buffer),
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('should use correct extension for WebP', async () => {
      await service.uploadPhoto(userId, file, 'image/webp');

      expect(mockPutObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/portfolio/mock-uuid-1234.webp',
        expect.any(Buffer),
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('should accept files exactly at max size', async () => {
      const maxFile = Buffer.alloc(5 * 1024 * 1024); // exactly at limit

      await expect(
        service.uploadPhoto(userId, maxFile, mimeType),
      ).resolves.toBeDefined();
    });
  });

  describe('deletePhoto', () => {
    const userId = 'user-123';
    const photoId = 'photo-id-456';

    it('should remove photo from MinIO and database', async () => {
      portfolioPhotoRepo.findOne.mockResolvedValueOnce({
        id: photoId,
        userId,
        storageKey: 'user-123/portfolio/photo-id-456.jpg',
        displayOrder: 0,
        caption: null,
        createdAt: new Date(),
      });

      await service.deletePhoto(userId, photoId);

      expect(mockRemoveObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/portfolio/photo-id-456.jpg',
      );
      expect(portfolioPhotoRepo.remove).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent photo', async () => {
      portfolioPhotoRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deletePhoto(userId, photoId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when photo belongs to different user', async () => {
      portfolioPhotoRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deletePhoto('other-user', photoId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should be idempotent when MinIO object already deleted', async () => {
      portfolioPhotoRepo.findOne.mockResolvedValueOnce({
        id: photoId,
        userId,
        storageKey: 'user-123/portfolio/photo-id-456.jpg',
        displayOrder: 0,
        caption: null,
        createdAt: new Date(),
      });

      mockRemoveObject.mockRejectedValueOnce({ code: 'NoSuchKey' });

      await expect(service.deletePhoto(userId, photoId)).resolves.toBeUndefined();
      expect(portfolioPhotoRepo.remove).toHaveBeenCalled();
    });
  });

  describe('getPhotos', () => {
    const userId = 'user-123';

    it('should return photos ordered by display_order with signed URLs', async () => {
      portfolioPhotoRepo.find.mockResolvedValueOnce([
        {
          id: 'photo-1',
          storageKey: 'user-123/portfolio/a.jpg',
          displayOrder: 0,
          caption: 'First',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'photo-2',
          storageKey: 'user-123/portfolio/b.jpg',
          displayOrder: 1,
          caption: null,
          createdAt: new Date('2024-01-02'),
        },
      ]);

      const result = await service.getPhotos(userId);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('photo-1');
      expect(result[0]!.url).toBe('https://minio.local/signed-url');
      expect(result[0]!.displayOrder).toBe(0);
      expect(result[0]!.caption).toBe('First');
      expect(result[1]!.id).toBe('photo-2');
      expect(result[1]!.displayOrder).toBe(1);

      expect(portfolioPhotoRepo.find).toHaveBeenCalledWith({
        where: { userId },
        order: { displayOrder: 'ASC' },
      });
    });

    it('should return empty array when user has no photos', async () => {
      portfolioPhotoRepo.find.mockResolvedValueOnce([]);

      const result = await service.getPhotos(userId);

      expect(result).toHaveLength(0);
    });
  });

  describe('getPhotoCount', () => {
    it('should return count of portfolio photos for user', async () => {
      portfolioPhotoRepo.count.mockResolvedValueOnce(5);

      const result = await service.getPhotoCount('user-123');

      expect(result).toBe(5);
      expect(portfolioPhotoRepo.count).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('should return 0 when user has no photos', async () => {
      portfolioPhotoRepo.count.mockResolvedValueOnce(0);

      const result = await service.getPhotoCount('user-123');

      expect(result).toBe(0);
    });
  });

  describe('generateSignedUrl', () => {
    it('should return signed URL from MinIO with correct expiry', async () => {
      const result = await service.generateSignedUrl('user-123/portfolio/photo.jpg');

      expect(mockPresignedGetObject).toHaveBeenCalledWith(
        'profile-photos',
        'user-123/portfolio/photo.jpg',
        3600,
      );
      expect(result).toBe('https://minio.local/signed-url');
    });
  });
});

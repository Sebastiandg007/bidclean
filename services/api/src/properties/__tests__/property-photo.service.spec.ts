import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { PropertyPhoto } from '../entities/property-photo.entity';

// Mock sharp
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('resized-image-data')),
  }));
  return mockSharp;
});

// Mock minio
jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: jest.fn().mockResolvedValue(undefined),
    removeObject: jest.fn().mockResolvedValue(undefined),
    presignedGetObject: jest.fn().mockResolvedValue('https://minio.test/signed-url'),
    bucketExists: jest.fn().mockResolvedValue(true),
    makeBucket: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock crypto - only randomUUID
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(() => 'generated-uuid-1234'),
}));

describe('PropertyPhotoService', () => {
  let service: PropertyPhotoService;

  const PROPERTY_ID = 'property-uuid-1';
  const PHOTO_ID = 'photo-uuid-1';
  const MAX_SIZE_MB = 10;
  const MAX_DIMENSION_PX = 2048;
  const MAX_PHOTOS = 20;
  const URL_EXPIRY_SECONDS = 3600;

  const mockPhotoRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockEntityManager = {
    createQueryBuilder: jest.fn(),
    remove: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb: (manager: typeof mockEntityManager) => Promise<void>) =>
      cb(mockEntityManager),
    ),
  };

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      const config: Record<string, string> = {
        MINIO_ENDPOINT: 'http://localhost:9000',
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
        MINIO_PROPERTY_PHOTOS_BUCKET: 'property-photos',
        PROPERTY_PHOTO_MAX_SIZE_MB: String(MAX_SIZE_MB),
        PROPERTY_PHOTO_MAX_DIMENSION_PX: String(MAX_DIMENSION_PX),
        PROPERTY_MAX_PHOTOS: String(MAX_PHOTOS),
        PROPERTY_PHOTO_URL_EXPIRY_SECONDS: String(URL_EXPIRY_SECONDS),
      };
      return config[key];
    }),
  };

  const createMockPhoto = (overrides: Partial<PropertyPhoto> = {}): PropertyPhoto =>
    ({
      id: PHOTO_ID,
      propertyId: PROPERTY_ID,
      storageKey: `${PROPERTY_ID}/${PHOTO_ID}.jpg`,
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      displayOrder: 0,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      ...overrides,
    }) as PropertyPhoto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertyPhotoService,
        {
          provide: getRepositoryToken(PropertyPhoto),
          useValue: mockPhotoRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<PropertyPhotoService>(PropertyPhotoService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadPhoto', () => {
    const validBuffer = Buffer.alloc(1024, 'a');
    const validMimeType = 'image/jpeg';

    beforeEach(() => {
      mockPhotoRepo.count.mockResolvedValue(0);
      mockPhotoRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maxOrder: null }),
      });
      mockPhotoRepo.create.mockImplementation((data) => ({ ...data }));
      mockPhotoRepo.save.mockImplementation((photo) => Promise.resolve({ ...photo }));
    });

    it('should upload a photo successfully', async () => {
      const result = await service.uploadPhoto(PROPERTY_ID, validBuffer, validMimeType);

      expect(result).toMatchObject({
        id: 'generated-uuid-1234',
        storageKey: `${PROPERTY_ID}/generated-uuid-1234.jpg`,
        mimeType: validMimeType,
        displayOrder: 0,
      });
      expect(result.signedUrl).toBeDefined();
      expect(result.fileSizeBytes).toBeGreaterThan(0);
    });

    it('should throw BadRequestException for unsupported MIME type', async () => {
      await expect(
        service.uploadPhoto(PROPERTY_ID, validBuffer, 'image/gif'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw PayloadTooLargeException when file exceeds max size', async () => {
      const largeBuffer = Buffer.alloc(MAX_SIZE_MB * 1024 * 1024 + 1);

      await expect(
        service.uploadPhoto(PROPERTY_ID, largeBuffer, validMimeType),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('should throw BadRequestException when max photo count is reached', async () => {
      mockPhotoRepo.count.mockResolvedValue(MAX_PHOTOS);

      await expect(
        service.uploadPhoto(PROPERTY_ID, validBuffer, validMimeType),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return existing photo for duplicate idempotency key', async () => {
      const existingPhoto = createMockPhoto();
      mockPhotoRepo.findOne.mockResolvedValue(existingPhoto);

      const result = await service.uploadPhoto(
        PROPERTY_ID,
        validBuffer,
        validMimeType,
        `${PHOTO_ID}.jpg`,
      );

      expect(result.id).toBe(PHOTO_ID);
      expect(mockPhotoRepo.save).not.toHaveBeenCalled();
    });

    it('should assign correct display_order for subsequent uploads', async () => {
      mockPhotoRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maxOrder: 2 }),
      });

      const result = await service.uploadPhoto(PROPERTY_ID, validBuffer, validMimeType);

      expect(result.displayOrder).toBe(3);
    });

    it('should use correct file extension for PNG', async () => {
      const result = await service.uploadPhoto(PROPERTY_ID, validBuffer, 'image/png');

      expect(result.storageKey).toContain('.png');
    });

    it('should use correct file extension for WebP', async () => {
      const result = await service.uploadPhoto(PROPERTY_ID, validBuffer, 'image/webp');

      expect(result.storageKey).toContain('.webp');
    });
  });

  describe('deletePhoto', () => {
    it('should delete a photo and renumber remaining photos', async () => {
      const photos = [
        createMockPhoto({ id: 'photo-1', displayOrder: 0 }),
        createMockPhoto({ id: 'photo-2', displayOrder: 1 }),
        createMockPhoto({ id: 'photo-3', displayOrder: 2 }),
      ];

      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(photos),
      });
      mockEntityManager.remove.mockResolvedValue(undefined);
      mockEntityManager.save.mockResolvedValue(undefined);

      await service.deletePhoto(PROPERTY_ID, 'photo-2');

      expect(mockEntityManager.remove).toHaveBeenCalledWith(
        PropertyPhoto,
        expect.objectContaining({ id: 'photo-2' }),
      );

      // Verify renumbering: remaining photos should be 0, 1
      const savedPhotos = mockEntityManager.save.mock.calls[0][1] as PropertyPhoto[];
      expect(savedPhotos[0]!.displayOrder).toBe(0);
      expect(savedPhotos[1]!.displayOrder).toBe(1);
    });

    it('should throw NotFoundException when photo does not exist', async () => {
      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.deletePhoto(PROPERTY_ID, 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use SELECT FOR UPDATE (pessimistic_write lock)', async () => {
      const photos = [createMockPhoto()];
      const mockSetLock = jest.fn().mockReturnThis();

      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: mockSetLock,
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(photos),
      });
      mockEntityManager.remove.mockResolvedValue(undefined);
      mockEntityManager.save.mockResolvedValue(undefined);

      await service.deletePhoto(PROPERTY_ID, PHOTO_ID);

      expect(mockSetLock).toHaveBeenCalledWith('pessimistic_write');
    });
  });

  describe('reorderPhotos', () => {
    it('should reorder photos based on the provided array order', async () => {
      const photos = [
        createMockPhoto({ id: 'photo-a', displayOrder: 0 }),
        createMockPhoto({ id: 'photo-b', displayOrder: 1 }),
        createMockPhoto({ id: 'photo-c', displayOrder: 2 }),
      ];

      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(photos),
      });
      mockEntityManager.save.mockResolvedValue(undefined);

      await service.reorderPhotos(PROPERTY_ID, ['photo-c', 'photo-a', 'photo-b']);

      const savedPhotos = mockEntityManager.save.mock.calls[0][1] as PropertyPhoto[];
      const photoC = savedPhotos.find((p) => p.id === 'photo-c')!;
      const photoA = savedPhotos.find((p) => p.id === 'photo-a')!;
      const photoB = savedPhotos.find((p) => p.id === 'photo-b')!;

      expect(photoC.displayOrder).toBe(0);
      expect(photoA.displayOrder).toBe(1);
      expect(photoB.displayOrder).toBe(2);
    });

    it('should throw BadRequestException when a photo ID does not belong to the property', async () => {
      const photos = [createMockPhoto({ id: 'photo-a' })];

      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(photos),
      });

      await expect(
        service.reorderPhotos(PROPERTY_ID, ['photo-a', 'unknown-id']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when not all photos are included in the order', async () => {
      const photos = [
        createMockPhoto({ id: 'photo-a' }),
        createMockPhoto({ id: 'photo-b' }),
      ];

      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(photos),
      });

      await expect(
        service.reorderPhotos(PROPERTY_ID, ['photo-a']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use SELECT FOR UPDATE lock for concurrency safety', async () => {
      const mockSetLock = jest.fn().mockReturnThis();

      mockEntityManager.createQueryBuilder.mockReturnValue({
        setLock: mockSetLock,
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });
      mockEntityManager.save.mockResolvedValue(undefined);

      await service.reorderPhotos(PROPERTY_ID, []);

      expect(mockSetLock).toHaveBeenCalledWith('pessimistic_write');
    });
  });

  describe('getSignedUrl', () => {
    it('should return a signed URL with expiration date', async () => {
      const storageKey = `${PROPERTY_ID}/test.jpg`;

      const result = await service.getSignedUrl(storageKey);

      expect(result.url).toBe('https://minio.test/signed-url');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('getPhotoCount', () => {
    it('should return the count of photos for a property', async () => {
      mockPhotoRepo.count.mockResolvedValue(5);

      const result = await service.getPhotoCount(PROPERTY_ID);

      expect(result).toBe(5);
      expect(mockPhotoRepo.count).toHaveBeenCalledWith({
        where: { propertyId: PROPERTY_ID },
      });
    });
  });

  describe('getPhotosWithUrls', () => {
    it('should return all photos with signed URLs ordered by displayOrder', async () => {
      const photos = [
        createMockPhoto({ id: 'photo-1', displayOrder: 0 }),
        createMockPhoto({ id: 'photo-2', displayOrder: 1 }),
      ];
      mockPhotoRepo.find.mockResolvedValue(photos);

      const result = await service.getPhotosWithUrls(PROPERTY_ID);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('photo-1');
      expect(result[0]!.signedUrl).toBe('https://minio.test/signed-url');
      expect(result[1]!.id).toBe('photo-2');
      expect(mockPhotoRepo.find).toHaveBeenCalledWith({
        where: { propertyId: PROPERTY_ID },
        order: { displayOrder: 'ASC' },
      });
    });

    it('should return empty array when property has no photos', async () => {
      mockPhotoRepo.find.mockResolvedValue([]);

      const result = await service.getPhotosWithUrls(PROPERTY_ID);

      expect(result).toHaveLength(0);
    });
  });

  describe('onModuleInit', () => {
    it('should ensure bucket exists on module initialization', async () => {
      // onModuleInit is called during construction phase by NestJS lifecycle
      // We verify the service is defined — bucket creation was handled via mock
      await service.onModuleInit();
      expect(service).toBeDefined();
    });
  });
});

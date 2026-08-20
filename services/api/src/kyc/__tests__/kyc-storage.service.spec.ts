import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KycStorageService } from '../storage/kyc-storage.service';
import { StorageCategory } from '../storage/kyc-storage.types';

/**
 * Mock MinIO client methods.
 */
const mockMinioClient = {
  putObject: jest.fn(),
  getObject: jest.fn(),
  removeObject: jest.fn(),
  statObject: jest.fn(),
  bucketExists: jest.fn(),
  makeBucket: jest.fn(),
};

/**
 * Mock the minio module to return our controlled mock client.
 */
jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => mockMinioClient),
}));

/**
 * Mock crypto.randomUUID for deterministic key generation tests.
 */
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn().mockReturnValue('test-uuid-1234'),
}));

describe('KycStorageService', () => {
  let service: KycStorageService;

  const mockConfigValues: Record<string, string> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ROOT_USER: 'bidclean',
    MINIO_ROOT_PASSWORD: 'bidclean_local',
    KYC_MINIO_BUCKET: 'kyc-documents',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMinioClient.bucketExists.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycStorageService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfigValues[key];
              if (!value) throw new Error(`Config key "${key}" not found`);
              return value;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<KycStorageService>(KycStorageService);
  });

  describe('onModuleInit', () => {
    it('should check if bucket exists on init', async () => {
      mockMinioClient.bucketExists.mockResolvedValue(true);

      await service.onModuleInit();

      expect(mockMinioClient.bucketExists).toHaveBeenCalledWith('kyc-documents');
    });

    it('should create bucket if it does not exist', async () => {
      mockMinioClient.bucketExists.mockResolvedValue(false);
      mockMinioClient.makeBucket.mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(mockMinioClient.makeBucket).toHaveBeenCalledWith('kyc-documents');
    });

    it('should not create bucket if it already exists', async () => {
      mockMinioClient.bucketExists.mockResolvedValue(true);

      await service.onModuleInit();

      expect(mockMinioClient.makeBucket).not.toHaveBeenCalled();
    });
  });

  describe('generateStorageKey', () => {
    it('should produce correct key format: kyc/{userId}/{category}/{uuid}.{ext}', () => {
      const key = service.generateStorageKey('user-123', StorageCategory.DOCUMENT, 'image/jpeg');

      expect(key).toBe('kyc/user-123/document/test-uuid-1234.jpg');
    });

    it('should use selfie category in the key', () => {
      const key = service.generateStorageKey('user-456', StorageCategory.SELFIE, 'image/png');

      expect(key).toBe('kyc/user-456/selfie/test-uuid-1234.png');
    });

    it('should fallback to bin extension for unknown mime types', () => {
      const key = service.generateStorageKey('user-789', StorageCategory.DOCUMENT, 'application/pdf');

      expect(key).toBe('kyc/user-789/document/test-uuid-1234.bin');
    });

    it('should handle webp mime type', () => {
      const key = service.generateStorageKey('user-001', StorageCategory.SELFIE, 'image/webp');

      expect(key).toBe('kyc/user-001/selfie/test-uuid-1234.webp');
    });
  });

  describe('upload', () => {
    it('should call MinIO putObject with encryption headers', async () => {
      const testBuffer = Buffer.from('fake-image-data');
      mockMinioClient.putObject.mockResolvedValue({ etag: 'abc123' });

      const result = await service.upload({
        buffer: testBuffer,
        mimeType: 'image/jpeg',
        userId: 'user-123',
        category: StorageCategory.DOCUMENT,
      });

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'kyc-documents',
        'kyc/user-123/document/test-uuid-1234.jpg',
        testBuffer,
        testBuffer.length,
        {
          'Content-Type': 'image/jpeg',
          'x-amz-server-side-encryption': 'AES256',
        },
      );

      expect(result.key).toBe('kyc/user-123/document/test-uuid-1234.jpg');
      expect(result.bucket).toBe('kyc-documents');
      expect(result.etag).toBe('abc123');
    });

    it('should propagate MinIO errors on upload failure', async () => {
      mockMinioClient.putObject.mockRejectedValue(new Error('Connection refused'));

      await expect(
        service.upload({
          buffer: Buffer.from('data'),
          mimeType: 'image/png',
          userId: 'user-123',
          category: StorageCategory.SELFIE,
        }),
      ).rejects.toThrow('Connection refused');
    });
  });

  describe('download', () => {
    function createMockStream(data: Buffer): NodeJS.ReadableStream {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      const stream = {
        on(event: string, callback: (...args: unknown[]) => void) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(callback);
          if (event === 'end') {
            // Emit data and end synchronously after both listeners attached
            process.nextTick(() => {
              listeners['data']?.forEach((cb) => cb(data));
              listeners['end']?.forEach((cb) => cb());
            });
          }
          return stream;
        },
      };
      return stream as unknown as NodeJS.ReadableStream;
    }

    it('should return buffer and content type from stored object', async () => {
      const fileContent = Buffer.from('stored-image-bytes');

      mockMinioClient.statObject.mockResolvedValue({
        metaData: { 'content-type': 'image/jpeg' },
      });
      mockMinioClient.getObject.mockResolvedValue(createMockStream(fileContent));

      const result = await service.download({ key: 'kyc/user/doc/file.jpg' });

      expect(result.buffer).toEqual(fileContent);
      expect(result.contentType).toBe('image/jpeg');
      expect(mockMinioClient.statObject).toHaveBeenCalledWith('kyc-documents', 'kyc/user/doc/file.jpg');
      expect(mockMinioClient.getObject).toHaveBeenCalledWith('kyc-documents', 'kyc/user/doc/file.jpg');
    });

    it('should fallback to application/octet-stream when content-type is missing', async () => {
      mockMinioClient.statObject.mockResolvedValue({ metaData: {} });
      mockMinioClient.getObject.mockResolvedValue(createMockStream(Buffer.from('data')));

      const result = await service.download({ key: 'kyc/user/doc/file.bin' });

      expect(result.contentType).toBe('application/octet-stream');
    });

    it('should propagate errors when object does not exist on download', async () => {
      mockMinioClient.statObject.mockRejectedValue({ code: 'NoSuchKey' });

      await expect(service.download({ key: 'nonexistent-key' })).rejects.toEqual({ code: 'NoSuchKey' });
    });
  });

  describe('delete', () => {
    it('should call removeObject on the correct bucket and key', async () => {
      mockMinioClient.removeObject.mockResolvedValue(undefined);

      await service.delete({ key: 'kyc/user-123/document/file.jpg' });

      expect(mockMinioClient.removeObject).toHaveBeenCalledWith(
        'kyc-documents',
        'kyc/user-123/document/file.jpg',
      );
    });

    it('should succeed silently when object is already deleted (NoSuchKey)', async () => {
      mockMinioClient.removeObject.mockRejectedValue({ code: 'NoSuchKey' });

      await expect(service.delete({ key: 'already-deleted-key' })).resolves.toBeUndefined();
    });

    it('should succeed silently when object is not found (NotFound)', async () => {
      mockMinioClient.removeObject.mockRejectedValue({ code: 'NotFound' });

      await expect(service.delete({ key: 'not-found-key' })).resolves.toBeUndefined();
    });

    it('should rethrow non-"not found" errors', async () => {
      const connectionError = new Error('Network timeout');
      mockMinioClient.removeObject.mockRejectedValue(connectionError);

      await expect(service.delete({ key: 'some-key' })).rejects.toThrow('Network timeout');
    });
  });
});

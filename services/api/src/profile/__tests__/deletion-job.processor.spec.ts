import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { DeletionJobProcessor } from '../account/deletion-job.processor';
import { KeycloakService } from '../../auth/keycloak/keycloak.service';
import { User } from '../../auth/entities/user.entity';
import { DeletionJobPayload } from '../profile.types';

// Mock Minio
jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    listObjects: jest.fn(),
    removeObjects: jest.fn(),
  })),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('DeletionJobProcessor', () => {
  let processor: DeletionJobProcessor;
  let keycloakService: jest.Mocked<Pick<KeycloakService, 'deleteUser'>>;
  let userRepository: { update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let minioClient: { listObjects: jest.Mock; removeObjects: jest.Mock };

  const mockPayload: DeletionJobPayload = {
    userId: 'user-123',
    keycloakId: 'kc-456',
    idempotencyKey: 'idem-789',
    requestedAt: new Date('2024-01-01'),
  };

  const mockJob = {
    data: mockPayload,
    id: 'job-1',
  } as unknown as Job<DeletionJobPayload>;

  const mockConfigValues: Record<string, string> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ROOT_USER: 'test-user',
    MINIO_ROOT_PASSWORD: 'test-pass',
    MINIO_PROFILE_PHOTOS_BUCKET: 'test-bucket',
    REVENUECAT_API_KEY: 'sk_test_key',
    REVENUECAT_API_URL: 'https://api.revenuecat.com/v1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    keycloakService = { deleteUser: jest.fn().mockResolvedValue(undefined) };

    userRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    const mockManager = {
      query: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (manager: typeof mockManager) => Promise<void>) => {
        await cb(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeletionJobProcessor,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) =>
              mockConfigValues[key] ?? defaultValue ?? '',
            ),
          },
        },
        { provide: KeycloakService, useValue: keycloakService },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    processor = module.get<DeletionJobProcessor>(DeletionJobProcessor);

    // Access the internal minio client for assertions
    minioClient = (processor as unknown as { minioClient: typeof minioClient }).minioClient;
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process — full cascade', () => {
    beforeEach(() => {
      // RevenueCat returns 200
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      // MinIO listObjects emits no data (empty bucket)
      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') {
            process.nextTick(handler);
          }
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);
    });

    it('should execute deletion cascade in correct order', async () => {
      await processor.process(mockJob);

      // Verify RevenueCat was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/subscribers/user-123'),
        expect.objectContaining({ method: 'DELETE' }),
      );

      // Verify Keycloak deletion
      expect(keycloakService.deleteUser).toHaveBeenCalledWith('kc-456');

      // Verify MinIO listing was attempted
      expect(minioClient.listObjects).toHaveBeenCalledWith('test-bucket', 'user-123/', true);

      // Verify PII anonymization (transaction was called)
      expect(dataSource.transaction).toHaveBeenCalled();

      // Verify user marked as DELETED
      expect(userRepository.update).toHaveBeenCalledWith('user-123', {
        deletionStatus: 'DELETED',
      });
    });

    it('should call steps in correct order (subscriptions → keycloak → minio → pii → mark)', async () => {
      const callOrder: string[] = [];

      mockFetch.mockImplementation(async () => {
        callOrder.push('revenuecat');
        return { ok: true, status: 200 };
      });

      keycloakService.deleteUser.mockImplementation(async () => {
        callOrder.push('keycloak');
      });

      minioClient.listObjects = jest.fn().mockImplementation(() => {
        callOrder.push('minio');
        const stream = {
          on: jest.fn().mockImplementation(function (this: typeof stream, event: string, handler: () => void) {
            if (event === 'end') process.nextTick(handler);
            return this;
          }),
        };
        return stream;
      });

      dataSource.transaction.mockImplementation(async (cb: (m: { query: jest.Mock }) => Promise<void>) => {
        callOrder.push('anonymize');
        await cb({ query: jest.fn() });
      });

      userRepository.update.mockImplementation(async () => {
        callOrder.push('mark_deleted');
        return { affected: 1 };
      });

      await processor.process(mockJob);

      expect(callOrder).toEqual([
        'revenuecat',
        'keycloak',
        'minio',
        'anonymize',
        'mark_deleted',
      ]);
    });
  });

  describe('idempotency on retry', () => {
    it('should skip RevenueCat if subscriber not found (404)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      // Setup rest of cascade to succeed
      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') process.nextTick(handler);
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);

      await processor.process(mockJob);

      // Should still proceed with remaining steps
      expect(keycloakService.deleteUser).toHaveBeenCalled();
      expect(userRepository.update).toHaveBeenCalled();
    });

    it('should skip Keycloak deletion if user already deleted (404 handled internally)', async () => {
      // RevenueCat success
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      // Keycloak deleteUser handles 404 internally (returns void)
      keycloakService.deleteUser.mockResolvedValue(undefined);

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') process.nextTick(handler);
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);

      await processor.process(mockJob);

      expect(keycloakService.deleteUser).toHaveBeenCalledWith('kc-456');
      expect(userRepository.update).toHaveBeenCalled();
    });

    it('should handle empty MinIO bucket gracefully', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') process.nextTick(handler);
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);

      await processor.process(mockJob);

      // removeObjects should NOT be called when no objects found
      expect(minioClient.removeObjects).not.toHaveBeenCalled();
    });
  });

  describe('step failure handling', () => {
    it('should throw on RevenueCat transient error (triggers BullMQ retry)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      await expect(processor.process(mockJob)).rejects.toThrow('RevenueCat API error 500');
    });

    it('should throw on Keycloak transient error', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      keycloakService.deleteUser.mockRejectedValue(new Error('Keycloak unavailable'));

      await expect(processor.process(mockJob)).rejects.toThrow('Keycloak unavailable');
    });

    it('should throw on MinIO error', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: (err?: Error) => void) {
          if (event === 'error') process.nextTick(() => handler(new Error('MinIO connection failed')));
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);

      await expect(processor.process(mockJob)).rejects.toThrow('MinIO connection failed');
    });

    it('should throw on database error during PII anonymization', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') process.nextTick(handler);
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);

      dataSource.transaction.mockRejectedValue(new Error('Database connection lost'));

      await expect(processor.process(mockJob)).rejects.toThrow('Database connection lost');
    });
  });

  describe('RevenueCat not configured', () => {
    it('should skip subscription cancellation when API key is empty', async () => {
      // Create a processor with no RevenueCat API key
      const moduleNoRC: TestingModule = await Test.createTestingModule({
        providers: [
          DeletionJobProcessor,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: string) => {
                if (key === 'REVENUECAT_API_KEY') return '';
                return mockConfigValues[key] ?? defaultValue ?? '';
              }),
            },
          },
          { provide: KeycloakService, useValue: keycloakService },
          { provide: getRepositoryToken(User), useValue: userRepository },
          { provide: DataSource, useValue: dataSource },
        ],
      }).compile();

      const processorNoRC = moduleNoRC.get<DeletionJobProcessor>(DeletionJobProcessor);
      const minioClientNoRC = (processorNoRC as unknown as { minioClient: typeof minioClient }).minioClient;

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') process.nextTick(handler);
          return this;
        }),
      };
      minioClientNoRC.listObjects = jest.fn().mockReturnValue(mockStream);

      await processorNoRC.process(mockJob);

      // fetch should NOT be called for RevenueCat
      expect(mockFetch).not.toHaveBeenCalled();

      // But the rest of the cascade should still execute
      expect(keycloakService.deleteUser).toHaveBeenCalled();
      expect(userRepository.update).toHaveBeenCalled();
    });
  });

  describe('PII anonymization verification', () => {
    it('should anonymize email, phone, display name, photo key, and bio', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: () => void) {
          if (event === 'end') process.nextTick(handler);
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);

      const transactionQueries: Array<{ sql: string; params: unknown[] }> = [];
      dataSource.transaction.mockImplementation(async (cb: (m: { query: (sql: string, params: unknown[]) => Promise<void> }) => Promise<void>) => {
        const mockManager = {
          query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
            transactionQueries.push({ sql, params });
          }),
        };
        await cb(mockManager);
      });

      await processor.process(mockJob);

      expect(transactionQueries).toHaveLength(2);

      const firstQuery = transactionQueries[0]!;
      const secondQuery = transactionQueries[1]!;

      // Verify users.email set to NULL
      expect(firstQuery.sql).toContain('UPDATE users SET email = NULL');
      expect(firstQuery.params).toContain('user-123');

      // Verify profile_details anonymization
      expect(secondQuery.sql).toContain('phone_number = NULL');
      expect(secondQuery.sql).toContain('display_name = $2');
      expect(secondQuery.sql).toContain('photo_storage_key = NULL');
      expect(secondQuery.sql).toContain('bio = NULL');
      expect(secondQuery.params).toContain('Deleted User');
    });
  });

  describe('MinIO file deletion with objects', () => {
    it('should list and remove all user objects', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const mockObjects = [
        { name: 'user-123/avatar.jpg' },
        { name: 'user-123/portfolio/photo1.png' },
        { name: 'user-123/portfolio/photo2.webp' },
      ];

      const mockStream = {
        on: jest.fn().mockImplementation(function (this: typeof mockStream, event: string, handler: (data?: { name: string }) => void) {
          if (event === 'data') {
            process.nextTick(() => {
              mockObjects.forEach((obj) => handler(obj));
            });
          }
          if (event === 'end') {
            process.nextTick(() => setTimeout(handler, 10));
          }
          return this;
        }),
      };
      minioClient.listObjects = jest.fn().mockReturnValue(mockStream);
      minioClient.removeObjects = jest.fn().mockResolvedValue(undefined);

      await processor.process(mockJob);

      expect(minioClient.removeObjects).toHaveBeenCalledWith(
        'test-bucket',
        ['user-123/avatar.jpg', 'user-123/portfolio/photo1.png', 'user-123/portfolio/photo2.webp'],
      );
    });
  });
});

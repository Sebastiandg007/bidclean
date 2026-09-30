import { ConfigService } from '@nestjs/config';

import { ChecklistStorageService } from '../storage/checklist-storage.service';

/**
 * Unit tests for ChecklistStorageService (Spec 19 · P4, P9, P15). The `minio` client and `sharp`
 * are fully mocked. Covers an unguessable key + scoped PUT URL; a TTL-expiry playback URL;
 * `inspectObject` returning server-observed size/content-type/dimensions and flagging missing/
 * unprobeable objects; and idempotent `deleteObjectSafe`.
 */

const mockPresignedPut = jest.fn();
const mockPresignedGet = jest.fn();
const mockStatObject = jest.fn();
const mockGetObject = jest.fn();
const mockRemoveObject = jest.fn();
const mockBucketExists = jest.fn().mockResolvedValue(true);
const mockMakeBucket = jest.fn().mockResolvedValue(undefined);

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    presignedPutObject: mockPresignedPut,
    presignedGetObject: mockPresignedGet,
    statObject: mockStatObject,
    getObject: mockGetObject,
    removeObject: mockRemoveObject,
    bucketExists: mockBucketExists,
    makeBucket: mockMakeBucket,
  })),
}));

const mockMetadata = jest.fn();
jest.mock('sharp', () => ({
  __esModule: true,
  default: jest.fn(() => ({ metadata: mockMetadata })),
}));

function makeConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const config: Record<string, string> = {
        MINIO_ENDPOINT: 'http://localhost:9000',
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      };
      return config[key] ?? '';
    },
  } as unknown as ConfigService;
}

function bufferStream(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe('ChecklistStorageService', () => {
  let service: ChecklistStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBucketExists.mockResolvedValue(true);
    service = new ChecklistStorageService(makeConfig());
  });

  it('generates an unguessable, sharded object key the client never chooses', () => {
    const a = service.generateObjectKey();
    const b = service.generateObjectKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{2}\/[0-9a-f-]{36}$/);
  });

  it('mints a scoped PUT URL with a TTL expiry for a single key', async () => {
    mockPresignedPut.mockResolvedValue('https://minio.test/put?sig=abc');
    const target = await service.presignUploadTarget('aa/key-1');
    expect(target.objectKey).toBe('aa/key-1');
    expect(target.uploadUrl).toBe('https://minio.test/put?sig=abc');
    expect(new Date(target.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(mockPresignedPut).toHaveBeenCalledWith(expect.any(String), 'aa/key-1', expect.any(Number));
  });

  it('mints a short-lived playback GET URL', async () => {
    mockPresignedGet.mockResolvedValue('https://minio.test/get?sig=xyz');
    const target = await service.getPlaybackTarget('aa/key-1');
    expect(target.playbackUrl).toBe('https://minio.test/get?sig=xyz');
    expect(new Date(target.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('inspectObject returns server-observed size/content-type/dimensions', async () => {
    mockStatObject.mockResolvedValue({ size: 2048, metaData: { 'content-type': 'image/png' } });
    mockGetObject.mockResolvedValue(bufferStream([Buffer.from('img')]));
    mockMetadata.mockResolvedValue({ width: 640, height: 480 });
    const result = await service.inspectObject('aa/key-1');
    expect(result).toEqual({ exists: true, sizeBytes: 2048, contentType: 'image/png', width: 640, height: 480 });
  });

  it('inspectObject flags an unprobeable object (dimensions null)', async () => {
    mockStatObject.mockResolvedValue({ size: 10, metaData: { 'content-type': 'image/jpeg' } });
    mockGetObject.mockResolvedValue(bufferStream([Buffer.from('nope')]));
    mockMetadata.mockRejectedValue(new Error('not an image'));
    const result = await service.inspectObject('aa/key-1');
    expect(result.exists).toBe(true);
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
  });

  it('inspectObject reports exists=false for a missing object', async () => {
    mockStatObject.mockRejectedValue({ code: 'NotFound' });
    const result = await service.inspectObject('aa/missing');
    expect(result.exists).toBe(false);
  });

  it('deleteObjectSafe is idempotent (already-deleted is a no-op)', async () => {
    mockRemoveObject.mockRejectedValueOnce({ code: 'NoSuchKey' });
    await expect(service.deleteObjectSafe('aa/gone')).resolves.toBeUndefined();
    mockRemoveObject.mockResolvedValueOnce(undefined);
    await expect(service.deleteObjectSafe('aa/here')).resolves.toBeUndefined();
  });
});

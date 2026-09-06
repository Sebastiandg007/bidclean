import { ConfigService } from '@nestjs/config';

import { VoiceNoteStorageService } from '../voice-note-storage.service';
import { AudioDurationProbe } from '../audio-duration.probe';

/**
 * Unit tests for VoiceNoteStorageService (task 3.2 · P4, P8, P9).
 *
 * The `minio` client is fully mocked. Covers: an unguessable key + scoped PUT URL; a playback URL
 * minted with a TTL expiry; `inspectObject` returning server-observed size/content-type/duration
 * and flagging a missing object; `deleteObjectSafe` idempotent (already-deleted is a no-op).
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

/** A stream-like async iterable over the given chunks (mirrors minio getObject). */
function bufferStream(chunks: Buffer[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe('VoiceNoteStorageService', () => {
  let service: VoiceNoteStorageService;
  let probe: AudioDurationProbe;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBucketExists.mockResolvedValue(true);
    probe = new AudioDurationProbe();
    service = new VoiceNoteStorageService(makeConfig(), probe);
  });

  it('generates an unguessable, sharded object key the client never chooses', () => {
    const a = service.generateObjectKey();
    const b = service.generateObjectKey();
    expect(a).not.toBe(b);
    // Sharded prefix `xx/<uuid>` — two hex chars, slash, then the uuid.
    expect(a).toMatch(/^[0-9a-f]{2}\/[0-9a-f-]{36}$/);
  });

  it('mints a scoped PUT URL with a TTL expiry for a single key', async () => {
    mockPresignedPut.mockResolvedValue('https://minio.test/put?sig=abc');
    const target = await service.presignUploadTarget('aa/key-1');
    expect(target.objectKey).toBe('aa/key-1');
    expect(target.uploadUrl).toBe('https://minio.test/put?sig=abc');
    expect(new Date(target.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The presign is scoped to exactly that one key.
    expect(mockPresignedPut).toHaveBeenCalledWith(expect.any(String), 'aa/key-1', expect.any(Number));
  });

  it('mints a short-lived playback GET URL', async () => {
    mockPresignedGet.mockResolvedValue('https://minio.test/get?sig=xyz');
    const target = await service.getPlaybackTarget('aa/key-1');
    expect(target.playbackUrl).toBe('https://minio.test/get?sig=xyz');
    expect(new Date(target.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('inspectObject returns server-observed size/content-type/duration', async () => {
    mockStatObject.mockResolvedValue({
      size: 2048,
      metaData: { 'content-type': 'audio/wav' },
    });
    // A minimal valid WAV: RIFF....WAVE + fmt (byteRate) + data chunk.
    const wav = buildWav(16000, 32000);
    mockGetObject.mockResolvedValue(bufferStream([wav]));

    const result = await service.inspectObject('aa/key-1');
    expect(result.exists).toBe(true);
    expect(result.sizeBytes).toBe(2048);
    expect(result.contentType).toBe('audio/wav');
    expect(result.durationMs).not.toBeNull();
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('inspectObject reports exists=false for a missing object', async () => {
    mockStatObject.mockRejectedValue({ code: 'NotFound' });
    const result = await service.inspectObject('missing');
    expect(result.exists).toBe(false);
    expect(result.durationMs).toBeNull();
  });

  it('inspectObject flags an unprobeable object with a null duration', async () => {
    mockStatObject.mockResolvedValue({ size: 10, metaData: { 'content-type': 'audio/wav' } });
    mockGetObject.mockResolvedValue(bufferStream([Buffer.from('not audio at all')]));
    const result = await service.inspectObject('aa/key-2');
    expect(result.exists).toBe(true);
    expect(result.durationMs).toBeNull();
  });

  it('deleteObjectSafe is idempotent (already-deleted is a no-op)', async () => {
    mockRemoveObject.mockRejectedValueOnce({ code: 'NoSuchKey' });
    await expect(service.deleteObjectSafe('gone')).resolves.toBeUndefined();
    mockRemoveObject.mockResolvedValueOnce(undefined);
    await expect(service.deleteObjectSafe('present')).resolves.toBeUndefined();
  });

  it('deleteObjectSafe rethrows a non-not-found error', async () => {
    mockRemoveObject.mockRejectedValueOnce({ code: 'AccessDenied' });
    await expect(service.deleteObjectSafe('x')).rejects.toBeDefined();
  });
});

/** Build a minimal valid WAV buffer with the given byteRate and data size. */
function buildWav(byteRate: number, dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(byteRate, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(Math.min(dataBytes, 8))]);
}
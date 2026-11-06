/**
 * Unit tests for voice.api (task 12.4).
 *
 * Covers the composed upload flow: requestUploadUrl -> PUT to MinIO -> sendVoiceMessageRequest as
 * one action, and requestPlaybackUrl. The shared apiClient and global `fetch` are mocked.
 */

import type { RecordedClip } from '../chat.types';

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../../../services/api.service', () => ({
  apiClient: { post: mockPost, get: mockGet },
}));

import {
  requestPlaybackUrl,
  uploadAndSendVoiceNote,
} from '../voice.api';

const clip: RecordedClip = {
  uri: 'file:///tmp/a.m4a',
  durationMs: 4000,
  sizeBytes: 2048,
  mimeType: 'audio/mp4',
};

describe('voice.api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      // First call: read local file into a blob.
      .mockResolvedValueOnce({ blob: async () => new Blob(['audio']) })
      // Second call: PUT to the pre-signed URL.
      .mockResolvedValueOnce({ ok: true, status: 200 });
  });

  it('composes upload-url -> PUT -> send message as one action', async () => {
    mockPost
      .mockResolvedValueOnce({
        data: { objectKey: 'k/o', uploadUrl: 'https://minio.test/put', expiresAt: 'soon' },
      })
      .mockResolvedValueOnce({
        data: { message: { id: 'srv-1', type: 'VOICE' }, deduplicated: false },
      });

    const result = await uploadAndSendVoiceNote('conv-1', 'cmid-1', clip, null);

    // Step 1: upload-url endpoint.
    expect(mockPost.mock.calls[0]?.[0]).toContain('/voice-notes/upload-url');
    // Step 2: PUT to the pre-signed storage URL (direct fetch, not apiClient).
    const putCall = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[1];
    expect(putCall?.[0]).toBe('https://minio.test/put');
    expect(putCall?.[1]?.method).toBe('PUT');
    // Step 3: send the VOICE message referencing the object key + Idempotency-Key header.
    const sendCall = mockPost.mock.calls[1];
    expect(sendCall?.[1]?.type).toBe('VOICE');
    expect(sendCall?.[1]?.objectKey).toBe('k/o');
    expect(sendCall?.[2]?.headers?.['Idempotency-Key']).toBe('cmid-1');
    expect(result.message.id).toBe('srv-1');
  });

  it('requestPlaybackUrl fetches a fresh pre-signed GET URL', async () => {
    mockGet.mockResolvedValueOnce({
      data: { playbackUrl: 'https://minio.test/get', expiresAt: 'soon' },
    });
    const target = await requestPlaybackUrl('conv-1', 'srv-1');
    expect(mockGet.mock.calls[0]?.[0]).toContain('/voice-notes/srv-1/playback-url');
    expect(target.playbackUrl).toBe('https://minio.test/get');
  });
});
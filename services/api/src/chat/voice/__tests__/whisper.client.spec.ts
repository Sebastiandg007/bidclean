import { ConfigService } from '@nestjs/config';

const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ post: mockPost })) },
}));

import { WhisperClient, WhisperHttpError, WhisperTimeoutError } from '../whisper.client';

/**
 * Unit tests for WhisperClient (task 7.3 · P10).
 *
 * axios is mocked. Covers: posts BYTES (multipart) and returns { text, language }; retries a
 * transient 5xx then succeeds; does not retry a deterministic 4xx; maps a timeout to a typed error.
 * The AI service receives bytes only — no storage reference is ever sent.
 */

function makeConfig(): ConfigService {
  return {
    get: (key: string) => {
      const config: Record<string, string> = {
        VOICE_AI_SERVICE_URL: 'http://ai.test',
        AI_SERVICE_AUTH_TOKEN: 'tok',
      };
      return config[key];
    },
  } as unknown as ConfigService;
}

describe('WhisperClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts audio bytes and returns text + language', async () => {
    mockPost.mockResolvedValue({ data: { text: 'hola mundo', language: 'es' } });
    const client = new WhisperClient(makeConfig());
    const result = await client.transcribe(Buffer.from('audio-bytes'));
    expect(result).toEqual({ text: 'hola mundo', language: 'es' });
    // The posted body is multipart form-data (has getHeaders), never a storage reference.
    const [path, body] = mockPost.mock.calls[0] as [string, { getHeaders?: () => unknown }];
    expect(path).toBe('/transcribe');
    expect(typeof body.getHeaders).toBe('function');
  });

  it('retries a transient 5xx then succeeds', async () => {
    jest.useFakeTimers();
    try {
      mockPost
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValueOnce({ data: { text: 'ok', language: null } });
      const client = new WhisperClient(makeConfig());
      const promise = client.transcribe(Buffer.from('x'));
      // Advance through the single backoff delay between the two attempts.
      await jest.runOnlyPendingTimersAsync();
      const result = await promise;
      expect(result.text).toBe('ok');
      expect(mockPost).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry a deterministic 4xx', async () => {
    mockPost.mockRejectedValue({ response: { status: 415 } });
    const client = new WhisperClient(makeConfig());
    await expect(client.transcribe(Buffer.from('x'))).rejects.toBeInstanceOf(WhisperHttpError);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('maps a timeout to a typed timeout error after bounded retries', async () => {
    jest.useFakeTimers();
    try {
      mockPost.mockRejectedValue({ code: 'ECONNABORTED' });
      const client = new WhisperClient(makeConfig());
      const promise = client.transcribe(Buffer.from('x'));
      const assertion = expect(promise).rejects.toBeInstanceOf(WhisperTimeoutError);
      // Flush all bounded backoff delays so the retry loop terminates.
      await jest.runAllTimersAsync();
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('defaults missing text to empty string', async () => {
    mockPost.mockResolvedValue({ data: {} });
    const client = new WhisperClient(makeConfig());
    const result = await client.transcribe(Buffer.from('x'));
    expect(result).toEqual({ text: '', language: null });
  });
});
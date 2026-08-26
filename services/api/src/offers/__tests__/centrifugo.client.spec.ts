import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { CentrifugoClient } from '../delivery/centrifugo.client';

// Mock axios at module level
jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * CentrifugoClient unit tests.
 *
 * Tests publish, broadcast, retry logic, and error handling.
 */
describe('CentrifugoClient', () => {
  let client: CentrifugoClient;
  let mockPost: jest.Mock;
  let mockConfigService: Partial<ConfigService>;

  const testApiUrl = 'http://centrifugo:8000';
  const testApiKey = 'test-api-key-secret';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockPost = jest.fn();
    mockedAxios.create.mockReturnValue({
      post: mockPost,
    } as unknown as ReturnType<typeof axios.create>);

    mockedAxios.isAxiosError.mockImplementation(
      (error) => !!(error as Record<string, unknown>)?.isAxiosError,
    );

    mockConfigService = {
      get: jest.fn((key: string, defaultVal?: unknown) => {
        const configMap: Record<string, unknown> = {
          CENTRIFUGO_API_URL: testApiUrl,
          CENTRIFUGO_API_KEY: testApiKey,
          CENTRIFUGO_TIMEOUT_MS: 5000,
        };
        return configMap[key] ?? defaultVal;
      }),
    };

    client = new CentrifugoClient(mockConfigService as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create axios instance with correct base URL and auth header', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: testApiUrl,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `apikey ${testApiKey}`,
          }),
        }),
      );
    });

    it('should use configured timeout from environment', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 5000,
        }),
      );
    });
  });

  describe('publish', () => {
    it('should send POST to /api/publish with channel and data', async () => {
      mockPost.mockResolvedValueOnce({ data: { result: {} } });

      const result = await client.publish('offers:cleaner:abc123', {
        type: 'new_offer',
        offerId: 'offer-1',
      });

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledWith('/api/publish', {
        channel: 'offers:cleaner:abc123',
        data: { type: 'new_offer', offerId: 'offer-1' },
      });
    });

    it('should return false and skip when channel is empty', async () => {
      const result = await client.publish('', { type: 'test' });

      expect(result).toBe(false);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should return false on non-transient error (4xx)', async () => {
      const error = createAxiosError(400, 'Bad Request');
      mockPost.mockRejectedValueOnce(error);

      const result = await client.publish('offers:cleaner:abc', { type: 'test' });

      expect(result).toBe(false);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx server error and succeed', async () => {
      const error = createAxiosError(502, 'Bad Gateway');
      mockPost
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: { result: {} } });

      const publishPromise = client.publish('offers:cleaner:abc', { type: 'test' });

      await jest.advanceTimersByTimeAsync(10_000);
      const result = await publishPromise;

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should retry on network error (no response)', async () => {
      const networkError = createNetworkError();
      mockPost
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ data: { result: {} } });

      const publishPromise = client.publish('offers:cleaner:abc', { type: 'test' });

      await jest.advanceTimersByTimeAsync(10_000);
      const result = await publishPromise;

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should return false after exhausting all retries', async () => {
      const error = createAxiosError(500, 'Internal Server Error');
      mockPost.mockRejectedValue(error);

      const publishPromise = client.publish('offers:cleaner:abc', { type: 'test' });

      // Advance enough time for all retries (backoff: 5000, 10000, 20000)
      await jest.advanceTimersByTimeAsync(60_000);
      const result = await publishPromise;

      expect(result).toBe(false);
      // 1 initial + 3 retries = 4 total attempts (maxRetries default = 3)
      expect(mockPost).toHaveBeenCalledTimes(4);
    });
  });

  describe('broadcast', () => {
    it('should send POST to /api/broadcast with channels array', async () => {
      mockPost.mockResolvedValueOnce({ data: { result: {} } });

      const channels = ['offers:cleaner:abc', 'offers:cleaner:def'];
      const result = await client.broadcast(channels, {
        type: 'new_offer',
        offerId: 'offer-1',
      });

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledWith('/api/broadcast', {
        channels,
        data: { type: 'new_offer', offerId: 'offer-1' },
      });
    });

    it('should return false and skip when channels array is empty', async () => {
      const result = await client.broadcast([], { type: 'test' });

      expect(result).toBe(false);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should retry broadcast on transient failure', async () => {
      const error = createAxiosError(503, 'Service Unavailable');
      mockPost
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: { result: {} } });

      const broadcastPromise = client.broadcast(
        ['offers:cleaner:abc'],
        { type: 'test' },
      );

      await jest.advanceTimersByTimeAsync(10_000);
      const result = await broadcastPromise;

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff', () => {
    it('should increase delay exponentially between retries', async () => {
      const error = createAxiosError(500, 'Internal Server Error');
      mockPost.mockRejectedValue(error);

      const publishPromise = client.publish('offers:cleaner:abc', { type: 'test' });

      // First retry after OFFER_BACKOFF_DELAY_MS * 2^0 = 5000ms
      await jest.advanceTimersByTimeAsync(4999);
      expect(mockPost).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(mockPost).toHaveBeenCalledTimes(2);

      // Second retry after OFFER_BACKOFF_DELAY_MS * 2^1 = 10000ms
      await jest.advanceTimersByTimeAsync(10_000);
      expect(mockPost).toHaveBeenCalledTimes(3);

      // Third retry after OFFER_BACKOFF_DELAY_MS * 2^2 = 20000ms
      await jest.advanceTimersByTimeAsync(20_000);
      expect(mockPost).toHaveBeenCalledTimes(4);

      await publishPromise;
    });
  });

  describe('missing configuration', () => {
    it('should handle missing CENTRIFUGO_API_URL gracefully', () => {
      const emptyConfig: Partial<ConfigService> = {
        get: jest.fn((key: string, defaultVal?: unknown) => {
          if (key === 'CENTRIFUGO_API_URL') return '';
          if (key === 'CENTRIFUGO_API_KEY') return testApiKey;
          return defaultVal;
        }),
      };

      expect(
        () => new CentrifugoClient(emptyConfig as ConfigService),
      ).not.toThrow();
    });

    it('should handle missing CENTRIFUGO_API_KEY gracefully', () => {
      const emptyConfig: Partial<ConfigService> = {
        get: jest.fn((key: string, defaultVal?: unknown) => {
          if (key === 'CENTRIFUGO_API_URL') return testApiUrl;
          if (key === 'CENTRIFUGO_API_KEY') return '';
          return defaultVal;
        }),
      };

      expect(
        () => new CentrifugoClient(emptyConfig as ConfigService),
      ).not.toThrow();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────────

function createAxiosError(status: number, message: string) {
  return {
    isAxiosError: true,
    response: { status, data: { error: { code: status, message } } },
    message,
  };
}

function createNetworkError() {
  return {
    isAxiosError: true,
    response: undefined,
    message: 'Network Error',
    code: 'ECONNREFUSED',
  };
}

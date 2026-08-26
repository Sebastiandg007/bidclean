import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { OneSignalClient } from '../notification/onesignal.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * OneSignalClient unit tests.
 *
 * Tests push notification delivery, configuration handling, and error scenarios.
 */
describe('OneSignalClient', () => {
  let client: OneSignalClient;
  let mockPost: jest.Mock;

  const testAppId = 'test-onesignal-app-id';
  const testApiKey = 'test-onesignal-api-key';
  const testApiUrl = 'https://onesignal.com/api/v1';

  const validPayload = {
    headings: { en: 'New Offer', es: 'Nueva Oferta' },
    contents: { en: 'A new offer is available', es: 'Una nueva oferta' },
    data: { type: 'offer_new', offerId: 'offer-123' },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPost = jest.fn();
    mockedAxios.create.mockReturnValue({
      post: mockPost,
    } as unknown as ReturnType<typeof axios.create>);

    mockedAxios.isAxiosError.mockImplementation(
      (error) => !!(error as Record<string, unknown>)?.isAxiosError,
    );

    const mockConfigService: Partial<ConfigService> = {
      get: jest.fn((key: string, defaultVal?: unknown) => {
        const configMap: Record<string, unknown> = {
          ONESIGNAL_APP_ID: testAppId,
          ONESIGNAL_API_KEY: testApiKey,
          ONESIGNAL_API_URL: testApiUrl,
          ONESIGNAL_TIMEOUT_MS: 10000,
        };
        return configMap[key] ?? defaultVal;
      }),
    };

    client = new OneSignalClient(mockConfigService as ConfigService);
  });

  describe('constructor', () => {
    it('should create axios instance with correct base URL and auth header', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: testApiUrl,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Basic ${testApiKey}`,
          }),
        }),
      );
    });

    it('should use configured timeout from environment', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 10000,
        }),
      );
    });
  });

  describe('sendToUser', () => {
    it('should send POST to /notifications with correct body structure', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'notif-1', recipients: 1 } });

      const result = await client.sendToUser('cleaner-abc', validPayload);

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledWith('/notifications', {
        app_id: testAppId,
        include_external_user_ids: ['cleaner-abc'],
        headings: validPayload.headings,
        contents: validPayload.contents,
        data: validPayload.data,
      });
    });

    it('should return true when OneSignal accepts the notification with recipients', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'notif-2', recipients: 1 } });

      const result = await client.sendToUser('cleaner-xyz', validPayload);

      expect(result).toBe(true);
    });

    it('should return true even when recipients count is 0 (accepted by API)', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'notif-3', recipients: 0 } });

      const result = await client.sendToUser('cleaner-offline', validPayload);

      expect(result).toBe(true);
    });

    it('should return false when externalUserId is empty', async () => {
      const result = await client.sendToUser('', validPayload);

      expect(result).toBe(false);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should return false when ONESIGNAL_APP_ID is not configured', async () => {
      const emptyAppConfig: Partial<ConfigService> = {
        get: jest.fn((key: string, defaultVal?: unknown) => {
          if (key === 'ONESIGNAL_APP_ID') return '';
          if (key === 'ONESIGNAL_API_KEY') return testApiKey;
          return defaultVal;
        }),
      };

      const clientNoAppId = new OneSignalClient(emptyAppConfig as ConfigService);
      const result = await clientNoAppId.sendToUser('cleaner-abc', validPayload);

      expect(result).toBe(false);
    });

    it('should return false on HTTP 4xx error', async () => {
      const error = {
        isAxiosError: true,
        response: { status: 400, data: { errors: ['Invalid payload'] } },
        message: 'Bad Request',
      };
      mockPost.mockRejectedValueOnce(error);

      const result = await client.sendToUser('cleaner-abc', validPayload);

      expect(result).toBe(false);
    });

    it('should return false on HTTP 5xx error', async () => {
      const error = {
        isAxiosError: true,
        response: { status: 500, data: { errors: ['Internal error'] } },
        message: 'Internal Server Error',
      };
      mockPost.mockRejectedValueOnce(error);

      const result = await client.sendToUser('cleaner-abc', validPayload);

      expect(result).toBe(false);
    });

    it('should return false on network error (no response)', async () => {
      const error = {
        isAxiosError: true,
        response: undefined,
        message: 'Network Error',
        code: 'ECONNREFUSED',
      };
      mockPost.mockRejectedValueOnce(error);

      const result = await client.sendToUser('cleaner-abc', validPayload);

      expect(result).toBe(false);
    });

    it('should return false on non-Axios error', async () => {
      mockPost.mockRejectedValueOnce(new Error('Unexpected failure'));

      const result = await client.sendToUser('cleaner-abc', validPayload);

      expect(result).toBe(false);
    });

    it('should not retry on failure (BullMQ handles retries)', async () => {
      const error = {
        isAxiosError: true,
        response: { status: 503, data: { errors: ['Service Unavailable'] } },
        message: 'Service Unavailable',
      };
      mockPost.mockRejectedValueOnce(error);

      await client.sendToUser('cleaner-abc', validPayload);

      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });
});

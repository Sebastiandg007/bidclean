import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { KycNotificationService } from '../kyc-notification.service';
import { KycStatus } from '../kyc.types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Unit tests for KycNotificationService.
 * Validates OneSignal push notification behavior for KYC status changes.
 */
describe('KycNotificationService', () => {
  let service: KycNotificationService;

  const MOCK_APP_ID = 'test-app-id-123';
  const MOCK_API_KEY = 'test-api-key-456';
  const MOCK_CUSTOM_URL = 'https://custom.onesignal.endpoint/api/v1/notifications';

  const buildConfigValues = (overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
    ONESIGNAL_APP_ID: MOCK_APP_ID,
    ONESIGNAL_API_KEY: MOCK_API_KEY,
    ONESIGNAL_API_URL: undefined,
    ...overrides,
  });

  const createService = (configValues: Record<string, string | undefined>): Promise<KycNotificationService> => {
    return Test.createTestingModule({
      providers: [
        KycNotificationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
      ],
    })
      .compile()
      .then((module: TestingModule) => module.get<KycNotificationService>(KycNotificationService));
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ data: { id: 'notification-id' } });
    service = await createService(buildConfigValues());
  });

  describe('notifyStatusChange - VERIFIED', () => {
    it('should send notification with correct payload for VERIFIED status', async () => {
      await service.notifyStatusChange('user-123', KycStatus.VERIFIED);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://onesignal.com/api/v1/notifications',
        {
          app_id: MOCK_APP_ID,
          include_external_user_ids: ['user-123'],
          contents: { en: 'Your identity has been verified successfully!' },
          headings: { en: 'KYC Verification Update' },
          data: { type: 'kyc_status_change', status: 'VERIFIED' },
        },
        {
          headers: {
            Authorization: `Basic ${MOCK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
    });
  });

  describe('notifyStatusChange - REJECTED', () => {
    it('should send notification with rejection reason in data payload', async () => {
      const reason = 'OCR confidence below threshold';

      await service.notifyStatusChange('user-456', KycStatus.REJECTED, reason);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://onesignal.com/api/v1/notifications',
        {
          app_id: MOCK_APP_ID,
          include_external_user_ids: ['user-456'],
          contents: { en: 'Your identity verification was not successful. Please try again.' },
          headings: { en: 'KYC Verification Update' },
          data: { type: 'kyc_status_change', status: 'REJECTED', rejectionReason: reason },
        },
        {
          headers: {
            Authorization: `Basic ${MOCK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
    });

    it('should not include rejectionReason in data when not provided', async () => {
      await service.notifyStatusChange('user-456', KycStatus.REJECTED);

      const callPayload = mockedAxios.post.mock.calls[0]![1] as Record<string, unknown>;
      expect(callPayload.data).toEqual({ type: 'kyc_status_change', status: 'REJECTED' });
    });
  });

  describe('missing configuration', () => {
    it('should skip silently when ONESIGNAL_APP_ID is not configured', async () => {
      service = await createService(buildConfigValues({ ONESIGNAL_APP_ID: undefined }));

      await service.notifyStatusChange('user-123', KycStatus.VERIFIED);

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should skip silently when ONESIGNAL_API_KEY is not configured', async () => {
      service = await createService(buildConfigValues({ ONESIGNAL_API_KEY: undefined }));

      await service.notifyStatusChange('user-123', KycStatus.VERIFIED);

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should skip silently when both env vars are missing', async () => {
      service = await createService(buildConfigValues({
        ONESIGNAL_APP_ID: undefined,
        ONESIGNAL_API_KEY: undefined,
      }));

      await service.notifyStatusChange('user-123', KycStatus.VERIFIED);

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should not throw when axios call fails with network error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network Error'));

      await expect(
        service.notifyStatusChange('user-123', KycStatus.VERIFIED),
      ).resolves.toBeUndefined();
    });

    it('should not throw when axios call fails with non-Error object', async () => {
      mockedAxios.post.mockRejectedValue('unexpected string error');

      await expect(
        service.notifyStatusChange('user-123', KycStatus.REJECTED, 'reason'),
      ).resolves.toBeUndefined();
    });
  });

  describe('custom API URL', () => {
    it('should use custom ONESIGNAL_API_URL when configured', async () => {
      service = await createService(buildConfigValues({ ONESIGNAL_API_URL: MOCK_CUSTOM_URL }));

      await service.notifyStatusChange('user-789', KycStatus.VERIFIED);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        MOCK_CUSTOM_URL,
        expect.any(Object),
        expect.any(Object),
      );
    });
  });
});

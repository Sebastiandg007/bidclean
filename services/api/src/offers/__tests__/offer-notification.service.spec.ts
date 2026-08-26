import { OfferNotificationService } from '../notification/offer-notification.service';
import { OneSignalClient } from '../notification/onesignal.client';
import { NOTIFICATION_CONTENT } from '../notification/notification.constants';

/**
 * OfferNotificationService unit tests.
 *
 * Tests push notification orchestration, payload building, and error handling.
 */
describe('OfferNotificationService', () => {
  let service: OfferNotificationService;
  let mockOneSignalClient: jest.Mocked<OneSignalClient>;

  beforeEach(() => {
    mockOneSignalClient = {
      sendToUser: jest.fn(),
    } as unknown as jest.Mocked<OneSignalClient>;

    service = new OfferNotificationService(mockOneSignalClient);
  });

  describe('sendOfferNotification', () => {
    it('should call OneSignalClient.sendToUser with cleanerId and correct payload', async () => {
      mockOneSignalClient.sendToUser.mockResolvedValueOnce(true);

      const result = await service.sendOfferNotification('cleaner-123', 'offer-456');

      expect(result).toBe(true);
      expect(mockOneSignalClient.sendToUser).toHaveBeenCalledWith(
        'cleaner-123',
        {
          headings: {
            en: NOTIFICATION_CONTENT.NEW_OFFER_HEADING_EN,
            es: NOTIFICATION_CONTENT.NEW_OFFER_HEADING_ES,
          },
          contents: {
            en: NOTIFICATION_CONTENT.NEW_OFFER_BODY_EN,
            es: NOTIFICATION_CONTENT.NEW_OFFER_BODY_ES,
          },
          data: {
            type: NOTIFICATION_CONTENT.OFFER_DATA_TYPE,
            offerId: 'offer-456',
          },
        },
      );
    });

    it('should return true when OneSignalClient reports success', async () => {
      mockOneSignalClient.sendToUser.mockResolvedValueOnce(true);

      const result = await service.sendOfferNotification('cleaner-abc', 'offer-xyz');

      expect(result).toBe(true);
    });

    it('should return false when OneSignalClient reports failure', async () => {
      mockOneSignalClient.sendToUser.mockResolvedValueOnce(false);

      const result = await service.sendOfferNotification('cleaner-abc', 'offer-xyz');

      expect(result).toBe(false);
    });

    it('should return false and not throw when OneSignalClient throws', async () => {
      mockOneSignalClient.sendToUser.mockRejectedValueOnce(
        new Error('Unexpected connection error'),
      );

      const result = await service.sendOfferNotification('cleaner-abc', 'offer-xyz');

      expect(result).toBe(false);
    });

    it('should include offerId in the data payload for deep linking', async () => {
      mockOneSignalClient.sendToUser.mockResolvedValueOnce(true);
      const offerId = 'offer-deep-link-test';

      await service.sendOfferNotification('cleaner-1', offerId);

      const callArgs = mockOneSignalClient.sendToUser.mock.calls[0];
      const calledPayload = callArgs![1];
      expect(calledPayload.data.offerId).toBe(offerId);
      expect(calledPayload.data.type).toBe(NOTIFICATION_CONTENT.OFFER_DATA_TYPE);
    });

    it('should include both English and Spanish translations in headings', async () => {
      mockOneSignalClient.sendToUser.mockResolvedValueOnce(true);

      await service.sendOfferNotification('cleaner-1', 'offer-1');

      const callArgs = mockOneSignalClient.sendToUser.mock.calls[0];
      const calledPayload = callArgs![1];
      expect(calledPayload.headings).toHaveProperty('en');
      expect(calledPayload.headings).toHaveProperty('es');
      expect(calledPayload.contents).toHaveProperty('en');
      expect(calledPayload.contents).toHaveProperty('es');
    });

    it('should pass cleanerId as the first argument to OneSignalClient', async () => {
      mockOneSignalClient.sendToUser.mockResolvedValueOnce(true);
      const cleanerId = 'cleaner-unique-id';

      await service.sendOfferNotification(cleanerId, 'offer-1');

      expect(mockOneSignalClient.sendToUser).toHaveBeenCalledWith(
        cleanerId,
        expect.any(Object),
      );
    });

    it('should handle multiple sequential calls independently', async () => {
      mockOneSignalClient.sendToUser
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result1 = await service.sendOfferNotification('cleaner-1', 'offer-1');
      const result2 = await service.sendOfferNotification('cleaner-2', 'offer-2');

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(mockOneSignalClient.sendToUser).toHaveBeenCalledTimes(2);
    });
  });
});

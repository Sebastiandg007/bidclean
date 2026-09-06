import { DataSource, EntityManager } from 'typeorm';

import { OfferNotificationService } from '../notification/offer-notification.service';
import {
  OFFER_AGGREGATE_TYPE,
  OFFER_OUTBOX_TABLE,
  OfferOutboxEventType,
} from '../notification/offer-outbox';

/**
 * OfferNotificationService unit tests (push Task 12, behavior-preserving migration).
 *
 * The service no longer calls OneSignal directly; it writes an `offer_outbox` `offer.matched` row
 * that the notifications relay drains. These tests assert the transactional outbox write, the
 * deterministic per-Cleaner event id, and the never-throw contract.
 */
describe('OfferNotificationService', () => {
  let service: OfferNotificationService;
  let mockManager: { query: jest.Mock };
  let mockDataSource: jest.Mocked<Pick<DataSource, 'transaction'>>;

  beforeEach(() => {
    mockManager = { query: jest.fn().mockResolvedValue(undefined) };
    mockDataSource = {
      // Mirror TypeORM's transaction(cb) overload used by the service.
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: EntityManager) => Promise<unknown>) =>
          cb(mockManager as unknown as EntityManager),
        ),
    } as unknown as jest.Mocked<Pick<DataSource, 'transaction'>>;

    service = new OfferNotificationService(mockDataSource as unknown as DataSource);
  });

  describe('sendOfferNotification', () => {
    it('should write exactly one offer_outbox row inside a transaction and return true', async () => {
      const result = await service.sendOfferNotification('cleaner-123', 'offer-456');

      expect(result).toBe(true);
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockManager.query).toHaveBeenCalledTimes(1);
      const [sql, values] = mockManager.query.mock.calls[0]!;
      expect(sql).toContain(`INSERT INTO "${OFFER_OUTBOX_TABLE}"`);
      // Positional params: event_id, aggregate_type, aggregate_id, type, payload, version.
      expect(values[1]).toBe(OFFER_AGGREGATE_TYPE);
      expect(values[2]).toBe('offer-456');
      expect(values[3]).toBe(OfferOutboxEventType.MATCHED);
    });

    it('should derive a deterministic event id per (offer, cleaner) for exactly-once', async () => {
      await service.sendOfferNotification('cleaner-abc', 'offer-xyz');

      const [, values] = mockManager.query.mock.calls[0]!;
      expect(values[0]).toBe(
        `${OFFER_AGGREGATE_TYPE}:offer-xyz:${OfferOutboxEventType.MATCHED}:cleaner-abc`,
      );
    });

    it('should carry recipient + offer ids in the payload (ids only)', async () => {
      await service.sendOfferNotification('cleaner-1', 'offer-deep-link-test');

      const [, values] = mockManager.query.mock.calls[0]!;
      const payload = JSON.parse(values[4] as string) as Record<string, unknown>;
      expect(payload).toEqual({
        recipientUserId: 'cleaner-1',
        offerId: 'offer-deep-link-test',
      });
    });

    it('should return false and not throw when the outbox write fails', async () => {
      mockManager.query.mockRejectedValueOnce(new Error('db down'));

      const result = await service.sendOfferNotification('cleaner-abc', 'offer-xyz');

      expect(result).toBe(false);
    });

    it('should handle multiple sequential calls independently', async () => {
      const result1 = await service.sendOfferNotification('cleaner-1', 'offer-1');
      mockManager.query.mockRejectedValueOnce(new Error('transient'));
      const result2 = await service.sendOfferNotification('cleaner-2', 'offer-2');

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
    });
  });
});

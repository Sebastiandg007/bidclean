/**
 * DeliverySchedulerService unit tests.
 *
 * Covers tier partitioning + routing (favorites-first vs pro-then-free), the
 * WebSocket→push fallback per Cleaner, delivery-status updates, and the stale-job
 * guard for delayed tier delivery.
 */
import { DeliverySchedulerService } from '../delivery/delivery-scheduler.service';
import { DeliveryTier, DeliveryStatus, OfferState } from '../offers.types';
import {
  OFFER_FAVORITES_WINDOW_MS,
  OFFER_PRO_FREE_DELAY_MS,
} from '../offers.constants';
import { DiscoveredCleaner } from '../discovery/cleaner-discovery.types';

const CLEANER_LAT = 4.7;
const CLEANER_LNG = -74.0;
const CLEANER_DISTANCE_METERS = 1000;

describe('DeliverySchedulerService', () => {
  let service: DeliverySchedulerService;
  let centrifugo: { publish: jest.Mock };
  let notifications: { sendOfferNotification: jest.Mock };
  let repository: {
    findById: jest.Mock;
    insertDelivery: jest.Mock;
    updateDeliveryStatus: jest.Mock;
  };
  let stateMachine: { transitionState: jest.Mock };
  let eventEmitter: { emitActivated: jest.Mock };
  let queue: { add: jest.Mock };

  const offerId = 'offer-1';

  const cleaner = (id: string, tier: DeliveryTier): DiscoveredCleaner => ({
    cleanerId: id,
    lat: CLEANER_LAT,
    lng: CLEANER_LNG,
    distanceMeters: CLEANER_DISTANCE_METERS,
    tier,
  });

  beforeEach(() => {
    centrifugo = { publish: jest.fn().mockResolvedValue(true) };
    notifications = { sendOfferNotification: jest.fn().mockResolvedValue(true) };
    repository = {
      findById: jest.fn().mockResolvedValue({ id: offerId, favoritesFirst: false }),
      insertDelivery: jest.fn().mockResolvedValue({ id: 'delivery-1' }),
      updateDeliveryStatus: jest.fn().mockResolvedValue(undefined),
    };
    stateMachine = { transitionState: jest.fn().mockResolvedValue(true) };
    eventEmitter = { emitActivated: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    service = new DeliverySchedulerService(
      centrifugo as never,
      notifications as never,
      repository as never,
      stateMachine as never,
      eventEmitter as never,
      queue as never,
    );
  });

  describe('deliverToCleaners', () => {
    it('does nothing when there are no cleaners', async () => {
      await service.deliverToCleaners(offerId, [], 0);
      expect(repository.findById).not.toHaveBeenCalled();
      expect(centrifugo.publish).not.toHaveBeenCalled();
    });

    it('skips delivery when the offer no longer exists', async () => {
      repository.findById.mockResolvedValue(null);
      await service.deliverToCleaners(offerId, [cleaner('c1', DeliveryTier.PRO)], 0);
      expect(centrifugo.publish).not.toHaveBeenCalled();
    });

    it('delivers to PRO immediately and schedules FREE (standard mode)', async () => {
      await service.deliverToCleaners(
        offerId,
        [cleaner('pro-1', DeliveryTier.PRO), cleaner('free-1', DeliveryTier.FREE)],
        0,
      );
      // PRO delivered now (WebSocket attempt)
      expect(centrifugo.publish).toHaveBeenCalledTimes(1);
      // FREE scheduled after the PRO->FREE delay
      expect(queue.add).toHaveBeenCalledWith(
        expect.stringContaining('deliver-free'),
        expect.objectContaining({ tier: DeliveryTier.FREE, cleanerIds: ['free-1'] }),
        { delay: OFFER_PRO_FREE_DELAY_MS },
      );
    });

    it('delivers to favorites first and schedules PRO + FREE when favoritesFirst is enabled', async () => {
      repository.findById.mockResolvedValue({ id: offerId, favoritesFirst: true });
      await service.deliverToCleaners(
        offerId,
        [
          cleaner('fav-1', DeliveryTier.FAVORITE),
          cleaner('pro-1', DeliveryTier.PRO),
          cleaner('free-1', DeliveryTier.FREE),
        ],
        0,
      );
      // Favorite delivered immediately
      expect(centrifugo.publish).toHaveBeenCalledTimes(1);
      // PRO scheduled after the favorites window
      expect(queue.add).toHaveBeenCalledWith(
        expect.stringContaining('deliver-pro'),
        expect.objectContaining({ tier: DeliveryTier.PRO }),
        { delay: OFFER_FAVORITES_WINDOW_MS },
      );
      // FREE scheduled after favorites window + PRO delay
      expect(queue.add).toHaveBeenCalledWith(
        expect.stringContaining('deliver-free'),
        expect.objectContaining({ tier: DeliveryTier.FREE }),
        { delay: OFFER_FAVORITES_WINDOW_MS + OFFER_PRO_FREE_DELAY_MS },
      );
    });

    it('falls back to push when WebSocket delivery fails', async () => {
      centrifugo.publish.mockResolvedValue(false);
      await service.deliverToCleaners(offerId, [cleaner('pro-1', DeliveryTier.PRO)], 0);
      expect(notifications.sendOfferNotification).toHaveBeenCalledWith('pro-1', offerId);
      expect(repository.updateDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: DeliveryStatus.SENT }),
      );
    });

    it('marks delivery FAILED when both channels fail', async () => {
      centrifugo.publish.mockResolvedValue(false);
      notifications.sendOfferNotification.mockResolvedValue(false);
      await service.deliverToCleaners(offerId, [cleaner('pro-1', DeliveryTier.PRO)], 0);
      expect(repository.updateDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: DeliveryStatus.FAILED }),
      );
    });

    it('triggers PUBLISHED -> ACTIVE on the first successful delivery', async () => {
      await service.deliverToCleaners(offerId, [cleaner('pro-1', DeliveryTier.PRO)], 0);
      expect(stateMachine.transitionState).toHaveBeenCalledWith(
        offerId,
        OfferState.PUBLISHED,
        OfferState.ACTIVE,
        expect.any(String),
      );
    });
  });

  describe('scheduleTierDelivery', () => {
    it('enqueues a delayed job for the tier', async () => {
      await service.scheduleTierDelivery(offerId, DeliveryTier.PRO, ['c1', 'c2'], 1, 30000);
      expect(queue.add).toHaveBeenCalledWith(
        expect.stringContaining('deliver-pro'),
        expect.objectContaining({ tier: DeliveryTier.PRO, cleanerIds: ['c1', 'c2'], radiusStep: 1 }),
        { delay: 30000 },
      );
    });

    it('does not enqueue when there are no cleaner ids', async () => {
      await service.scheduleTierDelivery(offerId, DeliveryTier.FREE, [], 1, 30000);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('processTierDeliveryJob (stale-job guard)', () => {
    it('skips a stale job when the offer is no longer eligible', async () => {
      repository.findById.mockResolvedValue({ id: offerId, state: OfferState.MATCHED });
      await service.processTierDeliveryJob({
        offerId,
        tier: DeliveryTier.FREE,
        cleanerIds: ['c1'],
        radiusStep: 0,
      });
      // No delivery record created for a stale job.
      expect(repository.insertDelivery).not.toHaveBeenCalled();
    });
  });
});

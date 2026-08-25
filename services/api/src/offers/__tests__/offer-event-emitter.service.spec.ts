import { EventEmitter2 } from '@nestjs/event-emitter';
import { OfferEventEmitterService } from '../events/offer-event-emitter.service';
import { OFFER_EVENT_NAMES } from '../events/offer-domain-events';
import { OfferState } from '../offers.types';

/**
 * OfferEventEmitterService unit tests.
 *
 * Validates that each emit method constructs the correct payload
 * and delegates to EventEmitter2 with the proper event name.
 */
describe('OfferEventEmitterService', () => {
  let service: OfferEventEmitterService;
  let mockEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(() => {
    mockEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;

    service = new OfferEventEmitterService(mockEmitter);
  });

  describe('emitCreated', () => {
    it('should emit offer.created event with correct payload', () => {
      const params = {
        offerId: 'offer-1',
        hostId: 'host-1',
        propertyId: 'property-1',
      };

      service.emitCreated(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.CREATED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.CREATED,
          offerId: 'offer-1',
          hostId: 'host-1',
          propertyId: 'property-1',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitPublished', () => {
    it('should emit offer.published event with correct payload', () => {
      const params = {
        offerId: 'offer-2',
        hostId: 'host-2',
        propertyId: 'property-2',
      };

      service.emitPublished(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.PUBLISHED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.PUBLISHED,
          offerId: 'offer-2',
          hostId: 'host-2',
          propertyId: 'property-2',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitActivated', () => {
    it('should emit offer.activated event with correct payload', () => {
      const params = {
        offerId: 'offer-3',
        hostId: 'host-3',
      };

      service.emitActivated(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.ACTIVATED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.ACTIVATED,
          offerId: 'offer-3',
          hostId: 'host-3',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitMatched', () => {
    it('should emit offer.matched event with correct payload', () => {
      const params = {
        offerId: 'offer-4',
        hostId: 'host-4',
        cleanerId: 'cleaner-1',
        matchSource: 'direct_accept',
      };

      service.emitMatched(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.MATCHED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.MATCHED,
          offerId: 'offer-4',
          hostId: 'host-4',
          cleanerId: 'cleaner-1',
          matchSource: 'direct_accept',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitCancelled', () => {
    it('should emit offer.cancelled event with correct payload', () => {
      const params = {
        offerId: 'offer-5',
        hostId: 'host-5',
        previousState: OfferState.ACTIVE,
      };

      service.emitCancelled(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.CANCELLED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.CANCELLED,
          offerId: 'offer-5',
          hostId: 'host-5',
          previousState: OfferState.ACTIVE,
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitExpired', () => {
    it('should emit offer.expired event with correct payload', () => {
      const params = {
        offerId: 'offer-6',
        hostId: 'host-6',
        finalRadius: 25000,
      };

      service.emitExpired(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.EXPIRED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.EXPIRED,
          offerId: 'offer-6',
          hostId: 'host-6',
          finalRadius: 25000,
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('emitCompleted', () => {
    it('should emit offer.completed event with correct payload', () => {
      const params = {
        offerId: 'offer-7',
        hostId: 'host-7',
        cleanerId: 'cleaner-2',
      };

      service.emitCompleted(params);

      expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        OFFER_EVENT_NAMES.COMPLETED,
        expect.objectContaining({
          type: OFFER_EVENT_NAMES.COMPLETED,
          offerId: 'offer-7',
          hostId: 'host-7',
          cleanerId: 'cleaner-2',
          timestamp: expect.any(Date),
        }),
      );
    });
  });

  describe('timestamp generation', () => {
    it('should attach a timestamp close to the current time', () => {
      const before = new Date();

      service.emitCreated({
        offerId: 'offer-ts',
        hostId: 'host-ts',
        propertyId: 'property-ts',
      });

      const after = new Date();
      const emittedEvent = mockEmitter.emit.mock.calls[0]![1] as { timestamp: Date };
      expect(emittedEvent.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(emittedEvent.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('event name consistency', () => {
    it('should use dot-notated event names matching OFFER_EVENT_NAMES constants', () => {
      expect(OFFER_EVENT_NAMES.CREATED).toBe('offer.created');
      expect(OFFER_EVENT_NAMES.PUBLISHED).toBe('offer.published');
      expect(OFFER_EVENT_NAMES.ACTIVATED).toBe('offer.activated');
      expect(OFFER_EVENT_NAMES.MATCHED).toBe('offer.matched');
      expect(OFFER_EVENT_NAMES.CANCELLED).toBe('offer.cancelled');
      expect(OFFER_EVENT_NAMES.EXPIRED).toBe('offer.expired');
      expect(OFFER_EVENT_NAMES.COMPLETED).toBe('offer.completed');
    });
  });
});

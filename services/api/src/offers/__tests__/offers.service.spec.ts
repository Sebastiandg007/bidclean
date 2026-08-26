/**
 * OffersService unit tests — publish flow.
 */
import {
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { OffersService } from '../offers.service';
import { OfferState } from '../offers.types';
import { OFFER_EXPANSION_INTERVAL_MS } from '../offers.constants';

describe('OffersService', () => {
  let service: OffersService;
  let mockRepository: any;
  let mockCommission: any;
  let mockEventEmitter: any;
  let mockStateMachine: any;
  let mockDataSource: any;
  let mockCentrifugoClient: any;
  let mockPropertyReadiness: any;
  let mockQueue: any;

  const hostId = 'host-uuid-123';
  const offerId = 'offer-uuid-456';
  const propertyId = 'property-uuid-789';

  const draftOffer = {
    id: offerId,
    hostId,
    propertyId,
    state: OfferState.DRAFT,
    serviceType: 'standard',
    offeredPriceCents: 5000,
    currency: 'USD',
  };

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      insertStateTransition: jest.fn(),
    };

    mockCommission = {
      getFullBreakdown: jest.fn(),
    };

    mockEventEmitter = {
      emitCreated: jest.fn(),
      emitPublished: jest.fn(),
    };

    mockStateMachine = {
      transitionState: jest.fn(),
    };

    mockDataSource = {
      query: jest.fn(),
    };

    mockPropertyReadiness = {
      check: jest.fn(),
    };

    mockCentrifugoClient = {
      publish: jest.fn().mockResolvedValue(true),
      broadcast: jest.fn().mockResolvedValue(true),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    service = new OffersService(
      mockRepository,
      mockCommission,
      mockEventEmitter,
      mockStateMachine,
      mockDataSource,
      mockCentrifugoClient,
      mockPropertyReadiness,
      mockQueue,
    );
  });

  describe('publish', () => {
    beforeEach(() => {
      mockRepository.findById.mockResolvedValue(draftOffer);
      mockStateMachine.transitionState.mockResolvedValue(true);
      mockDataSource.query
        .mockResolvedValueOnce([{ name: 'Beach House', type: 'apartment', address_city: 'Miami' }])
        .mockResolvedValueOnce([{ storage_key: 'photos/cover.jpg' }])
        .mockResolvedValueOnce(undefined); // persist publish fields
    });

    it('should transition DRAFT → PUBLISHED successfully', async () => {
      await service.publish(offerId, hostId, { favoritesFirst: false });

      expect(mockStateMachine.transitionState).toHaveBeenCalledWith(
        offerId,
        OfferState.DRAFT,
        OfferState.PUBLISHED,
        'host',
      );
    });

    it('should throw NotFoundException when offer not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.publish(offerId, hostId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when offer not owned by host', async () => {
      mockRepository.findById.mockResolvedValue({
        ...draftOffer,
        hostId: 'different-host-uuid',
      });

      await expect(service.publish(offerId, hostId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw UnprocessableEntityException when offer not in DRAFT state', async () => {
      mockRepository.findById.mockResolvedValue({
        ...draftOffer,
        state: OfferState.PUBLISHED,
      });

      await expect(service.publish(offerId, hostId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('should throw ConflictException when state transition fails (race condition)', async () => {
      mockStateMachine.transitionState.mockResolvedValue(false);

      await expect(service.publish(offerId, hostId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should snapshot property data on the offer', async () => {
      await service.publish(offerId, hostId);

      // First query: property data
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT p.name, p.type, p.address_city'),
        [propertyId],
      );

      // Second query: cover photo
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM property_photos'),
        [propertyId],
      );

      // Third query: persist publish fields
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE offers'),
        ['Beach House', 'apartment', 'Miami', 'photos/cover.jpg', false, offerId],
      );
    });

    it('should enqueue initial delivery job with delay 0', async () => {
      await service.publish(offerId, hostId);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'expand-radius',
        { offerId, expectedState: OfferState.PUBLISHED, expectedStep: 0 },
        { delay: 0 },
      );
    });

    it('should enqueue first expansion job with configured delay', async () => {
      await service.publish(offerId, hostId);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'expand-radius',
        { offerId, expectedState: OfferState.PUBLISHED, expectedStep: 1 },
        { delay: OFFER_EXPANSION_INTERVAL_MS },
      );
    });

    it('should emit OfferPublished event', async () => {
      await service.publish(offerId, hostId);

      expect(mockEventEmitter.emitPublished).toHaveBeenCalledWith({
        offerId,
        hostId,
        propertyId,
      });
    });

    it('should set published_at and favoritesFirst', async () => {
      await service.publish(offerId, hostId, { favoritesFirst: true });

      // The third query persists publish fields including favoritesFirst=true
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('published_at = NOW()'),
        expect.arrayContaining([true, offerId]),
      );
    });

    it('should default favoritesFirst to false when not provided', async () => {
      await service.publish(offerId, hostId);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('favorites_first = $5'),
        expect.arrayContaining([false, offerId]),
      );
    });

    it('should handle missing property photo gracefully', async () => {
      mockDataSource.query
        .mockReset()
        .mockResolvedValueOnce([{ name: 'Beach House', type: 'apartment', address_city: 'Miami' }])
        .mockResolvedValueOnce([]) // no photos
        .mockResolvedValueOnce(undefined);

      await service.publish(offerId, hostId);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE offers'),
        ['Beach House', 'apartment', 'Miami', null, false, offerId],
      );
    });
  });

  describe('create', () => {
    it.todo('should create an offer in DRAFT state');
    it.todo('should validate property readiness before creation');
    it.todo('should reject negative price');
    it.todo('should reject scheduled time without minimum lead');
    it.todo('should reject duplicate active offer for same property');
    it.todo('should support idempotency key');
  });

  describe('cancel', () => {
    it.todo('should cancel from DRAFT state');
    it.todo('should cancel from PUBLISHED state');
    it.todo('should cancel from ACTIVE state and notify Cleaners');
  });

  describe('findById', () => {
    it.todo('should return offer with state history');
    it.todo('should return null for non-existent offer');
  });

  describe('findByHostId', () => {
    it.todo('should return paginated results');
    it.todo('should filter by state');
  });
});

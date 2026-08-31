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
  let mockCommissionRates: any;
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

    mockCommissionRates = {
      resolveHostRate: jest.fn().mockResolvedValue({ rateBps: 1000, ruleId: null }),
      resolveCleanerRate: jest.fn().mockResolvedValue({ rateBps: 300, ruleId: null }),
      previewHostRate: jest.fn(),
      previewCleanerRate: jest.fn(),
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
      mockCommissionRates,
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
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const validDto = {
      propertyId,
      serviceType: 'standard',
      offeredPriceCents: 5000,
      currency: 'USD',
      scheduledAt: futureDate,
      timezone: 'America/Bogota',
      estimatedDurationMinutes: 120,
      description: 'Deep clean',
    };
    const breakdown = {
      offeredPriceCents: 5000,
      hostFeeCents: 500,
      hostTotalCents: 5500,
      cleanerCommissionCents: 150,
      cleanerPayoutCents: 4850,
      hostFeeRateBps: 1000,
      cleanerRateBps: 300,
    };

    beforeEach(() => {
      mockPropertyReadiness.check.mockResolvedValue({ ready: true, reasons: [] });
      mockCommission.getFullBreakdown.mockReturnValue(breakdown);
      mockRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({ id: offerId });
      // resolvePropertyCountry query returns the property's ISO country
      mockDataSource.query.mockResolvedValue([{ address_country: 'CO' }]);
    });

    it('should create an offer in DRAFT state', async () => {
      const result = await service.create(hostId, validDto);

      expect(result).toEqual({ id: offerId });
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ hostId, propertyId, state: OfferState.DRAFT }),
      );
      expect(mockRepository.insertStateTransition).toHaveBeenCalledWith(
        expect.objectContaining({ fromState: null, toState: OfferState.DRAFT, triggeredBy: 'host' }),
      );
      expect(mockEventEmitter.emitCreated).toHaveBeenCalledTimes(1);
    });

    it('should resolve the Host rate via COMMISSION_RATES and feed it to CommissionService', async () => {
      await service.create(hostId, validDto);

      expect(mockCommissionRates.resolveHostRate).toHaveBeenCalledWith({
        country: 'CO',
        hostId,
        serviceType: 'standard',
      });
      // resolved host bps (1000) is passed into getFullBreakdown as the 2nd arg
      expect(mockCommission.getFullBreakdown).toHaveBeenCalledWith(5000, 1000);
    });

    it('should still create when country lookup yields no row (env-default fallback)', async () => {
      mockDataSource.query.mockResolvedValue([]);
      mockCommissionRates.resolveHostRate.mockResolvedValue({ rateBps: 1000, ruleId: null });

      const result = await service.create(hostId, validDto);

      expect(result).toEqual({ id: offerId });
      expect(mockCommissionRates.resolveHostRate).toHaveBeenCalledWith(
        expect.objectContaining({ country: '', hostId }),
      );
    });

    it('should validate property readiness before creation', async () => {
      mockPropertyReadiness.check.mockResolvedValue({ ready: false, reasons: ['NO_PHOTOS'] });

      await expect(service.create(hostId, validDto)).rejects.toThrow(UnprocessableEntityException);
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should reject negative price', async () => {
      await expect(
        service.create(hostId, { ...validDto, offeredPriceCents: -100 }),
      ).rejects.toBeTruthy();
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should reject scheduled time without minimum lead', async () => {
      const tooSoon = new Date(Date.now() + 60 * 1000).toISOString();
      await expect(
        service.create(hostId, { ...validDto, scheduledAt: tooSoon }),
      ).rejects.toBeTruthy();
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should support idempotency key (returns existing offer)', async () => {
      mockRepository.findByIdempotencyKey.mockResolvedValue({ id: 'existing-offer' });

      const result = await service.create(hostId, { ...validDto, idempotencyKey: 'key-1' });

      expect(result).toEqual({ id: 'existing-offer' });
      expect(mockRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      mockStateMachine.transitionState.mockResolvedValue(true);
      mockDataSource.query.mockResolvedValue([]);
      mockEventEmitter.emitCancelled = jest.fn();
      // cancelPendingJobs (PUBLISHED/ACTIVE) drains the radius-expansion queue.
      mockQueue.getDelayed = jest.fn().mockResolvedValue([]);
      mockQueue.getWaiting = jest.fn().mockResolvedValue([]);
    });

    it('should cancel from DRAFT state', async () => {
      mockRepository.findById.mockResolvedValue({ ...draftOffer, state: OfferState.DRAFT });
      await service.cancel(offerId, hostId);
      expect(mockStateMachine.transitionState).toHaveBeenCalledWith(
        offerId,
        OfferState.DRAFT,
        OfferState.CANCELLED,
        'host',
      );
    });

    it('should cancel from PUBLISHED state and drain pending jobs', async () => {
      mockRepository.findById.mockResolvedValue({ ...draftOffer, state: OfferState.PUBLISHED });
      await service.cancel(offerId, hostId);
      expect(mockStateMachine.transitionState).toHaveBeenCalledWith(
        offerId,
        OfferState.PUBLISHED,
        OfferState.CANCELLED,
        'host',
      );
      expect(mockQueue.getDelayed).toHaveBeenCalled();
    });

    it('should reject cancelling an offer not owned by the host', async () => {
      mockRepository.findById.mockResolvedValue({ ...draftOffer, hostId: 'other-host' });
      await expect(service.cancel(offerId, hostId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when offer does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);
      await expect(service.cancel(offerId, hostId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return offer with state history for the owner', async () => {
      mockRepository.findById.mockResolvedValue({
        ...draftOffer,
        stateTransitions: [
          { fromState: null, toState: OfferState.DRAFT, triggeredBy: 'host', createdAt: new Date() },
        ],
      });

      const result = await service.findById(offerId, hostId);

      expect(result).not.toBeNull();
      expect(mockRepository.findById).toHaveBeenCalledWith(offerId, ['stateTransitions']);
    });

    it('should return null for non-existent offer', async () => {
      mockRepository.findById.mockResolvedValue(null);
      await expect(service.findById(offerId, hostId)).resolves.toBeNull();
    });

    it('should return null when the offer is not owned by the requester', async () => {
      mockRepository.findById.mockResolvedValue({ ...draftOffer, hostId: 'other-host' });
      await expect(service.findById(offerId, hostId)).resolves.toBeNull();
    });
  });

  describe('findByHostId', () => {
    it('should return paginated results mapped to summaries', async () => {
      mockRepository.findByHostId = jest.fn().mockResolvedValue({
        items: [draftOffer],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });

      const result = await service.findByHostId(hostId, { page: 1, pageSize: 20 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.page).toBe(1);
    });

    it('should pass the state filter through to the repository', async () => {
      const findByHostId = jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });
      mockRepository.findByHostId = findByHostId;

      await service.findByHostId(hostId, { state: OfferState.ACTIVE, page: 1, pageSize: 20 });

      expect(findByHostId).toHaveBeenCalledWith(
        hostId,
        expect.objectContaining({ state: OfferState.ACTIVE }),
      );
    });
  });
});

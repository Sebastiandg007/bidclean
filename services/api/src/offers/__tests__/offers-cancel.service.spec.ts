import {
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { OffersService } from '../offers.service';
import { OfferState } from '../offers.types';

/**
 * Unit tests for OffersService.cancel()
 *
 * Covers:
 * - Successful cancellation from each valid state (DRAFT, PUBLISHED, ACTIVE)
 * - Rejection from terminal/non-cancellable states (MATCHED, COMPLETED, EXPIRED, CANCELLED)
 * - Ownership validation (NotFoundException, ForbiddenException)
 * - Race condition handling (ConflictException)
 * - Side effects: job cancellation, Centrifugo notification, event emission
 */

interface MockRepository {
  findById: jest.Mock;
  findDeliveredCleanerIds: jest.Mock;
}

interface MockStateMachine {
  transitionState: jest.Mock;
}

interface MockEventEmitter {
  emitCancelled: jest.Mock;
}

interface MockCentrifugoClient {
  broadcast: jest.Mock;
}

interface MockQueue {
  getDelayed: jest.Mock;
  getWaiting: jest.Mock;
}

interface MockDataSource {
  query: jest.Mock;
}

describe('OffersService.cancel', () => {
  const OFFER_ID = 'offer-uuid-123';
  const HOST_ID = 'host-uuid-456';
  const OTHER_HOST_ID = 'other-host-789';

  let service: OffersService;
  let mockOffersRepository: MockRepository;
  let mockStateMachine: MockStateMachine;
  let mockEventEmitter: MockEventEmitter;
  let mockCentrifugoClient: MockCentrifugoClient;
  let mockRadiusExpansionQueue: MockQueue;
  let mockDataSource: MockDataSource;

  function createMockOffer(state: OfferState, hostId = HOST_ID) {
    return {
      id: OFFER_ID,
      hostId,
      state,
      propertyId: 'property-uuid-001',
    };
  }

  beforeEach(() => {
    mockOffersRepository = {
      findById: jest.fn(),
      findDeliveredCleanerIds: jest.fn().mockResolvedValue([]),
    };

    mockStateMachine = {
      transitionState: jest.fn().mockResolvedValue(true),
    };

    mockEventEmitter = {
      emitCancelled: jest.fn(),
    };

    mockCentrifugoClient = {
      broadcast: jest.fn().mockResolvedValue(true),
    };

    mockRadiusExpansionQueue = {
      getDelayed: jest.fn().mockResolvedValue([]),
      getWaiting: jest.fn().mockResolvedValue([]),
    };

    mockDataSource = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    service = new OffersService(
      mockOffersRepository as never,
      {} as never, // commissionService — not used in cancel
      mockEventEmitter as never,
      mockStateMachine as never,
      mockDataSource as never,
      mockCentrifugoClient as never,
      {} as never, // propertyReadiness — not used in cancel
      {} as never, // commissionRates — not used in cancel
      mockRadiusExpansionQueue as never,
    );
  });

  describe('successful cancellation', () => {
    it('should cancel a DRAFT offer without job cancellation or notification', async () => {
      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.DRAFT));

      await service.cancel(OFFER_ID, HOST_ID);

      expect(mockStateMachine.transitionState).toHaveBeenCalledWith(
        OFFER_ID,
        OfferState.DRAFT,
        OfferState.CANCELLED,
        'host',
      );
      expect(mockDataSource.query).toHaveBeenCalledWith(
        'UPDATE offers SET cancelled_at = NOW() WHERE id = $1',
        [OFFER_ID],
      );
      expect(mockRadiusExpansionQueue.getDelayed).not.toHaveBeenCalled();
      expect(mockRadiusExpansionQueue.getWaiting).not.toHaveBeenCalled();
      expect(mockCentrifugoClient.broadcast).not.toHaveBeenCalled();
      expect(mockEventEmitter.emitCancelled).toHaveBeenCalledWith({
        offerId: OFFER_ID,
        hostId: HOST_ID,
        previousState: OfferState.DRAFT,
      });
    });

    it('should cancel a PUBLISHED offer with job cancellation but no notification', async () => {
      const mockJob = { data: { offerId: OFFER_ID }, remove: jest.fn().mockResolvedValue(undefined) };
      const otherJob = { data: { offerId: 'other-offer' }, remove: jest.fn() };

      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.PUBLISHED));
      mockRadiusExpansionQueue.getDelayed.mockResolvedValue([mockJob, otherJob]);
      mockRadiusExpansionQueue.getWaiting.mockResolvedValue([]);

      await service.cancel(OFFER_ID, HOST_ID);

      expect(mockStateMachine.transitionState).toHaveBeenCalledWith(
        OFFER_ID,
        OfferState.PUBLISHED,
        OfferState.CANCELLED,
        'host',
      );
      expect(mockRadiusExpansionQueue.getDelayed).toHaveBeenCalled();
      expect(mockRadiusExpansionQueue.getWaiting).toHaveBeenCalled();
      expect(mockJob.remove).toHaveBeenCalled();
      expect(otherJob.remove).not.toHaveBeenCalled();
      expect(mockCentrifugoClient.broadcast).not.toHaveBeenCalled();
      expect(mockEventEmitter.emitCancelled).toHaveBeenCalledWith({
        offerId: OFFER_ID,
        hostId: HOST_ID,
        previousState: OfferState.PUBLISHED,
      });
    });

    it('should cancel an ACTIVE offer with job cancellation and cleaner notification', async () => {
      const cleanerIds = ['cleaner-1', 'cleaner-2', 'cleaner-3'];
      const mockJob = { data: { offerId: OFFER_ID }, remove: jest.fn().mockResolvedValue(undefined) };

      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.ACTIVE));
      mockOffersRepository.findDeliveredCleanerIds.mockResolvedValue(cleanerIds);
      mockRadiusExpansionQueue.getDelayed.mockResolvedValue([mockJob]);
      mockRadiusExpansionQueue.getWaiting.mockResolvedValue([]);

      await service.cancel(OFFER_ID, HOST_ID);

      expect(mockStateMachine.transitionState).toHaveBeenCalledWith(
        OFFER_ID,
        OfferState.ACTIVE,
        OfferState.CANCELLED,
        'host',
      );
      expect(mockJob.remove).toHaveBeenCalled();
      expect(mockCentrifugoClient.broadcast).toHaveBeenCalledWith(
        ['offers:cleaner:cleaner-1', 'offers:cleaner:cleaner-2', 'offers:cleaner:cleaner-3'],
        { type: 'offer_cancelled', offerId: OFFER_ID },
      );
      expect(mockEventEmitter.emitCancelled).toHaveBeenCalledWith({
        offerId: OFFER_ID,
        hostId: HOST_ID,
        previousState: OfferState.ACTIVE,
      });
    });
  });

  describe('state validation — non-cancellable states', () => {
    it('should reject cancellation of a MATCHED offer', async () => {
      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.MATCHED));

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockStateMachine.transitionState).not.toHaveBeenCalled();
    });

    it('should reject cancellation of a COMPLETED offer', async () => {
      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.COMPLETED));

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockStateMachine.transitionState).not.toHaveBeenCalled();
    });

    it('should reject cancellation of an EXPIRED offer', async () => {
      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.EXPIRED));

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockStateMachine.transitionState).not.toHaveBeenCalled();
    });

    it('should reject cancellation of an already CANCELLED offer', async () => {
      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.CANCELLED));

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockStateMachine.transitionState).not.toHaveBeenCalled();
    });
  });

  describe('ownership and existence validation', () => {
    it('should throw NotFoundException for non-existent offer', async () => {
      mockOffersRepository.findById.mockResolvedValue(null);

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStateMachine.transitionState).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException for offer not owned by host', async () => {
      mockOffersRepository.findById.mockResolvedValue(
        createMockOffer(OfferState.DRAFT, OTHER_HOST_ID),
      );

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockStateMachine.transitionState).not.toHaveBeenCalled();
    });
  });

  describe('race condition handling', () => {
    it('should throw ConflictException when state machine returns false', async () => {
      mockOffersRepository.findById.mockResolvedValue(createMockOffer(OfferState.ACTIVE));
      mockStateMachine.transitionState.mockResolvedValue(false);

      await expect(service.cancel(OFFER_ID, HOST_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(mockDataSource.query).not.toHaveBeenCalled();
      expect(mockEventEmitter.emitCancelled).not.toHaveBeenCalled();
    });
  });
});

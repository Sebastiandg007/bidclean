import { validateTransition, OfferStateMachineService } from './offer-state-machine';
import { OfferState } from '../offers.types';
import { Offer } from '../entities/offer.entity';
import { OfferStateTransition } from '../entities/offer-state-transition.entity';

/**
 * Offer state machine unit tests.
 * Validates transition rules and service behavior (optimistic locking, audit trail).
 */
describe('OfferStateMachine', () => {
  describe('validateTransition', () => {
    it('should allow DRAFT → PUBLISHED', () => {
      const result = validateTransition(OfferState.DRAFT, OfferState.PUBLISHED);
      expect(result.valid).toBe(true);
    });

    it('should allow DRAFT → CANCELLED', () => {
      const result = validateTransition(OfferState.DRAFT, OfferState.CANCELLED);
      expect(result.valid).toBe(true);
    });

    it('should reject DRAFT → ACTIVE', () => {
      const result = validateTransition(OfferState.DRAFT, OfferState.ACTIVE);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should reject transitions from terminal states', () => {
      const terminalStates = [OfferState.COMPLETED, OfferState.CANCELLED, OfferState.EXPIRED];
      for (const state of terminalStates) {
        const result = validateTransition(state, OfferState.DRAFT);
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('OfferStateMachineService', () => {
    let service: OfferStateMachineService;
    let mockOfferRepo: {
      createQueryBuilder: jest.Mock;
    };
    let mockTransitionRepo: {
      save: jest.Mock;
    };

    /** Reusable mock query builder chain */
    function createMockQueryBuilder(affected: number) {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      return qb;
    }

    beforeEach(() => {
      mockOfferRepo = {
        createQueryBuilder: jest.fn(),
      };
      mockTransitionRepo = {
        save: jest.fn().mockResolvedValue({}),
      };

      service = new OfferStateMachineService(
        mockOfferRepo as unknown as import('typeorm').Repository<Offer>,
        mockTransitionRepo as unknown as import('typeorm').Repository<OfferStateTransition>,
      );
    });

    it('should return true and insert audit trail on valid transition', async () => {
      const qb = createMockQueryBuilder(1);
      mockOfferRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.transitionState(
        'offer-123',
        OfferState.DRAFT,
        OfferState.PUBLISHED,
        'host',
      );

      expect(result).toBe(true);
      expect(qb.update).toHaveBeenCalledWith(Offer);
      expect(qb.set).toHaveBeenCalledWith({
        state: OfferState.PUBLISHED,
        updatedAt: expect.any(Function),
      });
      expect(qb.where).toHaveBeenCalledWith(
        'id = :offerId AND state = :expectedState',
        { offerId: 'offer-123', expectedState: OfferState.DRAFT },
      );
      expect(mockTransitionRepo.save).toHaveBeenCalledWith({
        offerId: 'offer-123',
        fromState: OfferState.DRAFT,
        toState: OfferState.PUBLISHED,
        triggeredBy: 'host',
        metadata: null,
      });
    });

    it('should return false without DB call for invalid transition', async () => {
      const result = await service.transitionState(
        'offer-123',
        OfferState.DRAFT,
        OfferState.ACTIVE,
        'host',
      );

      expect(result).toBe(false);
      expect(mockOfferRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockTransitionRepo.save).not.toHaveBeenCalled();
    });

    it('should return false and skip audit trail on race condition (affected === 0)', async () => {
      const qb = createMockQueryBuilder(0);
      mockOfferRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.transitionState(
        'offer-123',
        OfferState.DRAFT,
        OfferState.PUBLISHED,
        'system',
      );

      expect(result).toBe(false);
      expect(qb.execute).toHaveBeenCalled();
      expect(mockTransitionRepo.save).not.toHaveBeenCalled();
    });

    it('should pass metadata correctly to audit trail', async () => {
      const qb = createMockQueryBuilder(1);
      mockOfferRepo.createQueryBuilder.mockReturnValue(qb);
      const metadata = { reason: 'host_requested', cancellationNote: 'No longer needed' };

      const result = await service.transitionState(
        'offer-456',
        OfferState.PUBLISHED,
        OfferState.CANCELLED,
        'host',
        metadata,
      );

      expect(result).toBe(true);
      expect(mockTransitionRepo.save).toHaveBeenCalledWith({
        offerId: 'offer-456',
        fromState: OfferState.PUBLISHED,
        toState: OfferState.CANCELLED,
        triggeredBy: 'host',
        metadata,
      });
    });
  });
});

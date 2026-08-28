import { NegotiationReconciliationService } from '../reconciliation/negotiation-reconciliation.service';
import { SupersededReason } from '../negotiation.types';

/**
 * Unit tests for NegotiationReconciliationService.
 *
 * Feature: offer-negotiation
 * Validates the periodic repair of partial post-terminal state: supersede lingering
 * PENDING proposals, close threads, and (for MATCHED offers) re-publish
 * offer_status_changed{MATCHED} to other delivered Cleaners (design repair B2).
 */
describe('NegotiationReconciliationService', () => {
  let negotiationRepo: {
    findThreadsNeedingReconciliation: jest.Mock;
    supersedePendingForOffer: jest.Mock;
    closeThreadsForOffer: jest.Mock;
    findMatchedCleanerId: jest.Mock;
    findOtherDeliveredCleaners: jest.Mock;
  };
  let publisher: { publishOfferMatchedToOtherCleaners: jest.Mock };
  let service: NegotiationReconciliationService;

  beforeEach(() => {
    negotiationRepo = {
      findThreadsNeedingReconciliation: jest.fn().mockResolvedValue([]),
      supersedePendingForOffer: jest.fn().mockResolvedValue(1),
      closeThreadsForOffer: jest.fn().mockResolvedValue(undefined),
      findMatchedCleanerId: jest.fn().mockResolvedValue('winner-1'),
      findOtherDeliveredCleaners: jest.fn().mockResolvedValue(['cleaner-a', 'cleaner-b']),
    };
    publisher = { publishOfferMatchedToOtherCleaners: jest.fn().mockResolvedValue(undefined) };
    service = new NegotiationReconciliationService(negotiationRepo as never, publisher as never);
  });

  it('supersedes lingering PENDING proposals and closes threads for a terminal offer', async () => {
    negotiationRepo.findThreadsNeedingReconciliation.mockResolvedValue([
      { offer_id: 'offer-1', offer_state: 'CANCELLED' },
    ]);

    await service.reconcile();

    expect(negotiationRepo.supersedePendingForOffer).toHaveBeenCalledWith(
      'offer-1',
      SupersededReason.OFFER_CANCELLED,
    );
    expect(negotiationRepo.closeThreadsForOffer).toHaveBeenCalledWith('offer-1');
    // Not a match → no radar re-publish
    expect(publisher.publishOfferMatchedToOtherCleaners).not.toHaveBeenCalled();
  });

  it('re-publishes offer_status_changed{MATCHED} to other cleaners for a matched offer (B2)', async () => {
    negotiationRepo.findThreadsNeedingReconciliation.mockResolvedValue([
      { offer_id: 'offer-9', offer_state: 'MATCHED' },
    ]);

    await service.reconcile();

    expect(negotiationRepo.findMatchedCleanerId).toHaveBeenCalledWith('offer-9');
    expect(negotiationRepo.findOtherDeliveredCleaners).toHaveBeenCalledWith('offer-9', 'winner-1');
    expect(publisher.publishOfferMatchedToOtherCleaners).toHaveBeenCalledWith(
      ['cleaner-a', 'cleaner-b'],
      'offer-9',
    );
  });

  it('skips the re-publish when the winner cannot be determined', async () => {
    negotiationRepo.findThreadsNeedingReconciliation.mockResolvedValue([
      { offer_id: 'offer-9', offer_state: 'MATCHED' },
    ]);
    negotiationRepo.findMatchedCleanerId.mockResolvedValue(null);

    await service.reconcile();

    expect(publisher.publishOfferMatchedToOtherCleaners).not.toHaveBeenCalled();
  });

  it('never throws even if the repository fails', async () => {
    negotiationRepo.findThreadsNeedingReconciliation.mockRejectedValue(new Error('db down'));
    await expect(service.reconcile()).resolves.toBeUndefined();
  });
});

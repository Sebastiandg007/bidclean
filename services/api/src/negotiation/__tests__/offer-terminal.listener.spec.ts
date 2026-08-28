import { OfferTerminalListener } from '../listeners/offer-terminal.listener';
import { SupersededReason } from '../negotiation.types';
import { OFFER_EVENT_NAMES } from '../../offers/events/offer-domain-events';
import type {
  OfferMatchedEvent,
  OfferCancelledEvent,
  OfferExpiredEvent,
} from '../../offers/events/offer-domain-events';
import { OfferState } from '../../offers/offers.types';

/**
 * Unit tests for OfferTerminalListener — the single supersession authority.
 *
 * Feature: offer-negotiation
 * Validates Correctness Property P10 (match supersession) and terminal handling
 * for cancelled/expired offers.
 */
describe('OfferTerminalListener', () => {
  let negotiationRepo: {
    supersedePendingForOffer: jest.Mock;
    closeThreadsForOffer: jest.Mock;
  };
  let listener: OfferTerminalListener;

  beforeEach(() => {
    negotiationRepo = {
      supersedePendingForOffer: jest.fn().mockResolvedValue(2),
      closeThreadsForOffer: jest.fn().mockResolvedValue(undefined),
    };
    listener = new OfferTerminalListener(negotiationRepo as never);
  });

  it('Property P10: on offer.matched supersedes remaining PENDING (OFFER_MATCHED) and closes threads', async () => {
    const event: OfferMatchedEvent = {
      type: OFFER_EVENT_NAMES.MATCHED,
      offerId: 'offer-1',
      hostId: 'host-1',
      cleanerId: 'cleaner-1',
      matchSource: 'negotiation',
      timestamp: new Date(),
    };

    await listener.handleOfferMatched(event);

    expect(negotiationRepo.supersedePendingForOffer).toHaveBeenCalledWith(
      'offer-1',
      SupersededReason.OFFER_MATCHED,
    );
    expect(negotiationRepo.closeThreadsForOffer).toHaveBeenCalledWith('offer-1');
  });

  it('on offer.cancelled supersedes PENDING with OFFER_CANCELLED and closes threads', async () => {
    const event: OfferCancelledEvent = {
      type: OFFER_EVENT_NAMES.CANCELLED,
      offerId: 'offer-2',
      hostId: 'host-1',
      previousState: OfferState.ACTIVE,
      timestamp: new Date(),
    };

    await listener.handleOfferCancelled(event);

    expect(negotiationRepo.supersedePendingForOffer).toHaveBeenCalledWith(
      'offer-2',
      SupersededReason.OFFER_CANCELLED,
    );
    expect(negotiationRepo.closeThreadsForOffer).toHaveBeenCalledWith('offer-2');
  });

  it('on offer.expired supersedes PENDING with OFFER_EXPIRED and closes threads', async () => {
    const event: OfferExpiredEvent = {
      type: OFFER_EVENT_NAMES.EXPIRED,
      offerId: 'offer-3',
      hostId: 'host-1',
      finalRadius: 15000,
      timestamp: new Date(),
    };

    await listener.handleOfferExpired(event);

    expect(negotiationRepo.supersedePendingForOffer).toHaveBeenCalledWith(
      'offer-3',
      SupersededReason.OFFER_EXPIRED,
    );
    expect(negotiationRepo.closeThreadsForOffer).toHaveBeenCalledWith('offer-3');
  });
});

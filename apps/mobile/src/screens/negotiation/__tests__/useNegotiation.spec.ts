/**
 * Unit tests for useNegotiationStore.
 *
 * Feature: offer-negotiation
 * Covers: direct accept success/conflict, counteroffer, host inbox mutations,
 * version/eventId-gated real-time handling, deviation-bounds mirror, and payout preview.
 */

import { useNegotiationStore } from '../useNegotiation';
import type { ThreadView, HostInboxItem, NegotiationEvent } from '../negotiation.types';

jest.mock('../negotiation.api', () => ({
  acceptOfferRequest: jest.fn(),
  createCounterofferRequest: jest.fn(),
  acceptProposalRequest: jest.fn(),
  rejectProposalRequest: jest.fn(),
  counterProposalRequest: jest.fn(),
  fetchThreadRequest: jest.fn(),
  fetchHostInboxRequest: jest.fn(),
}));

import * as api from '../negotiation.api';

const mockedApi = api as jest.Mocked<typeof api>;

function makeThread(overrides: Partial<ThreadView> = {}): ThreadView {
  return {
    id: 'thread-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    status: 'OPEN',
    basePriceCents: 10000,
    currency: 'USD',
    version: 1,
    proposalCount: 1,
    proposals: [],
    ...overrides,
  };
}

function makeInboxItem(overrides: Partial<HostInboxItem> = {}): HostInboxItem {
  return {
    offerId: 'offer-1',
    propertyName: 'Apt 1A',
    cleaner: { cleanerId: 'cleaner-1', fullName: 'Jane C' },
    basePriceCents: 10000,
    hostFeeRateBps: 1000,
    cleanerRateBps: 300,
    proposal: {
      id: 'proposal-1',
      threadId: 'thread-1',
      offerId: 'offer-1',
      actor: 'CLEANER',
      sequenceNumber: 1,
      proposedPriceCents: 9000,
      cleanerPayoutCents: 8730,
      hostTotalCents: 9900,
      currency: 'USD',
      status: 'PENDING',
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function resetStore(): void {
  useNegotiationStore.getState().reset();
}

describe('useNegotiationStore', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  describe('acceptOffer', () => {
    it('returns success with the match summary', async () => {
      mockedApi.acceptOfferRequest.mockResolvedValue({
        offerId: 'offer-1',
        cleanerId: 'cleaner-1',
        agreedPriceCents: 10000,
        cleanerPayoutCents: 9700,
        hostTotalCents: 11000,
        currency: 'USD',
        matchedProposalId: null,
      });

      const result = await useNegotiationStore.getState().acceptOffer('offer-1');
      expect(result.success).toBe(true);
      expect(result.match?.offerId).toBe('offer-1');
    });

    it('maps a 409 conflict to the offer_unavailable error key', async () => {
      mockedApi.acceptOfferRequest.mockRejectedValue({ response: { status: 409 } });

      const result = await useNegotiationStore.getState().acceptOffer('offer-1');
      expect(result.success).toBe(false);
      expect(result.errorKey).toBe('negotiation.error.offer_unavailable');
    });
  });

  describe('acceptCounteroffer (host)', () => {
    it('removes all inbox items for the matched offer', async () => {
      useNegotiationStore.setState({
        inbox: [makeInboxItem(), makeInboxItem({ offerId: 'offer-2' })],
      });
      mockedApi.acceptProposalRequest.mockResolvedValue({
        offerId: 'offer-1',
        cleanerId: 'cleaner-1',
        agreedPriceCents: 9000,
        cleanerPayoutCents: 8730,
        hostTotalCents: 9900,
        currency: 'USD',
        matchedProposalId: 'proposal-1',
      });

      await useNegotiationStore.getState().acceptCounteroffer('proposal-1');

      const { inbox } = useNegotiationStore.getState();
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!.offerId).toBe('offer-2');
    });
  });

  describe('rejectCounteroffer (host)', () => {
    it('removes the rejected proposal from the inbox', async () => {
      useNegotiationStore.setState({ inbox: [makeInboxItem()] });
      mockedApi.rejectProposalRequest.mockResolvedValue({} as never);

      await useNegotiationStore.getState().rejectCounteroffer('proposal-1');
      expect(useNegotiationStore.getState().inbox).toHaveLength(0);
    });
  });

  describe('handleNegotiationEvent — dedup and version gating', () => {
    it('ignores a duplicate eventId', async () => {
      const event: NegotiationEvent = {
        eventId: 'evt-1',
        type: 'negotiation_proposal_countered',
        threadId: 'thread-1',
        proposalId: 'proposal-1',
        offerId: 'offer-1',
        version: 5,
        sequenceNumber: 2,
        occurredAt: new Date().toISOString(),
      };
      mockedApi.fetchThreadRequest.mockResolvedValue(makeThread({ version: 5 }));

      useNegotiationStore.getState().handleNegotiationEvent(event);
      useNegotiationStore.getState().handleNegotiationEvent(event);

      // fetchThread triggered at most once for the unique eventId
      expect(mockedApi.fetchThreadRequest).toHaveBeenCalledTimes(1);
    });

    it('discards an event whose version is not newer than the held thread', () => {
      useNegotiationStore.setState({
        myThreads: new Map([['offer-1', makeThread({ version: 10 })]]),
      });

      const staleEvent: NegotiationEvent = {
        eventId: 'evt-stale',
        type: 'negotiation_proposal_countered',
        threadId: 'thread-1',
        proposalId: 'proposal-1',
        offerId: 'offer-1',
        version: 4,
        sequenceNumber: 1,
        occurredAt: new Date().toISOString(),
      };

      useNegotiationStore.getState().handleNegotiationEvent(staleEvent);
      expect(mockedApi.fetchThreadRequest).not.toHaveBeenCalled();
    });
  });

  describe('deviation bounds mirror + payout preview', () => {
    it('isWithinBounds matches the +/-20% default range around the base price', () => {
      const store = useNegotiationStore.getState();
      // base 10000, default 2000 bps each side => [8000, 12000]
      expect(store.isWithinBounds(10000, 8000)).toBe(true);
      expect(store.isWithinBounds(10000, 12000)).toBe(true);
      expect(store.isWithinBounds(10000, 7999)).toBe(false);
      expect(store.isWithinBounds(10000, 12001)).toBe(false);
    });

    it('computePreviewPayout uses integer truncation matching the backend formula', () => {
      const store = useNegotiationStore.getState();
      const breakdown = store.computePreviewPayout(9999, 1000, 300, 'USD');
      // hostFee = trunc(9999*1000/10000)=999 ; commission = trunc(9999*300/10000)=299
      expect(breakdown.hostTotalCents).toBe(9999 + 999);
      expect(breakdown.cleanerPayoutCents).toBe(9999 - 299);
    });
  });
});

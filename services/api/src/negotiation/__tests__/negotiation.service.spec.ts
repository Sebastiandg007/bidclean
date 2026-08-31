import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { NegotiationService } from '../negotiation.service';
import { NegotiationPricingService } from '../pricing/negotiation-pricing.service';
import { CommissionService } from '../../offers/commission/commission.service';
import { OfferState } from '../../offers/offers.types';
import { ProposalActor, ProposalStatus, SupersededReason } from '../negotiation.types';

/**
 * Unit + property-based tests for NegotiationService orchestration.
 *
 * Feature: offer-negotiation
 * Validates P1 (single winner), P7 (authorization), P8 (offer-state gate),
 * P9 (idempotency), P10 (match supersession — winner ACCEPTED).
 *
 * Dependencies (repository, OfferMatchContract, publisher, idempotency) are mocked.
 */

const HOST_RATE_BPS = 1000;
const CLEANER_RATE_BPS = 300;
const BASE_PRICE = 10000;

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    hostId: 'host-1',
    offeredPriceCents: BASE_PRICE,
    currency: 'USD',
    state: OfferState.ACTIVE,
    hostServiceFeeRateBps: HOST_RATE_BPS,
    cleanerCommissionRateBps: CLEANER_RATE_BPS,
    ...overrides,
  };
}

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    status: 'OPEN',
    basePriceCents: BASE_PRICE,
    currency: 'USD',
    version: 1,
    proposalCount: 1,
    ...overrides,
  };
}

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1',
    threadId: 'thread-1',
    actor: ProposalActor.CLEANER,
    sequenceNumber: 1,
    proposedPriceCents: 9000,
    cleanerPayoutCents: 8730,
    hostTotalCents: 9900,
    currency: 'USD',
    status: ProposalStatus.PENDING,
    expiresAt: new Date(Date.now() + 900000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('NegotiationService', () => {
  let service: NegotiationService;

  // Mocks
  let offerMatch: { match: jest.Mock };
  let offerRepo: { findOne: jest.Mock; query: jest.Mock };
  let commissionRates: {
    resolveHostRate: jest.Mock;
    resolveCleanerRate: jest.Mock;
    previewHostRate: jest.Mock;
    previewCleanerRate: jest.Mock;
  };
  let negotiationRepo: {
    findThread: jest.Mock;
    findThreadById: jest.Mock;
    findProposalById: jest.Mock;
    listProposals: jest.Mock;
    getOrCreateThread: jest.Mock;
    insertProposalLocked: jest.Mock;
    markProposalCountered: jest.Mock;
    setProposalStatus: jest.Mock;
    markProposalAccepted: jest.Mock;
    persistMatchedCleanerRate: jest.Mock;
    hasSentDelivery: jest.Mock;
    findOtherDeliveredCleaners: jest.Mock;
    findHostInbox: jest.Mock;
  };
  let publisher: Record<string, jest.Mock>;
  // Idempotency mock: runs the work function directly (fresh path), tracking replays.
  let idempotency: { runOnce: jest.Mock };

  beforeEach(() => {
    offerMatch = { match: jest.fn().mockResolvedValue({ success: true }) };
    offerRepo = {
      findOne: jest.fn().mockResolvedValue(makeOffer()),
      // resolveOfferCountry runs a raw query against properties
      query: jest.fn().mockResolvedValue([{ address_country: 'US' }]),
    };
    // commission-system contract: resolve the winning Cleaner rate at match.
    // Returns the same default 300 bps so payout arithmetic is unchanged here.
    commissionRates = {
      resolveHostRate: jest.fn(),
      resolveCleanerRate: jest.fn().mockResolvedValue({ rateBps: CLEANER_RATE_BPS, ruleId: null }),
      previewHostRate: jest.fn(),
      previewCleanerRate: jest.fn(),
    };
    negotiationRepo = {
      findThread: jest.fn().mockResolvedValue(null),
      findThreadById: jest.fn().mockResolvedValue(makeThread()),
      findProposalById: jest.fn().mockResolvedValue(makeProposal()),
      listProposals: jest.fn().mockResolvedValue([]),
      getOrCreateThread: jest.fn().mockResolvedValue(makeThread({ proposalCount: 0 })),
      insertProposalLocked: jest
        .fn()
        .mockResolvedValue({ proposal: makeProposal(), threadVersion: 1 }),
      markProposalCountered: jest.fn().mockResolvedValue(undefined),
      setProposalStatus: jest.fn().mockResolvedValue(undefined),
      markProposalAccepted: jest.fn().mockResolvedValue(undefined),
      persistMatchedCleanerRate: jest.fn().mockResolvedValue(undefined),
      hasSentDelivery: jest.fn().mockResolvedValue(true),
      findOtherDeliveredCleaners: jest.fn().mockResolvedValue([]),
      findHostInbox: jest.fn().mockResolvedValue([]),
    };
    publisher = {
      publishProposalCreatedToHost: jest.fn().mockResolvedValue(undefined),
      publishProposalCounteredToCleaner: jest.fn().mockResolvedValue(undefined),
      publishProposalRejected: jest.fn().mockResolvedValue(undefined),
      publishProposalAccepted: jest.fn().mockResolvedValue(undefined),
      publishOfferMatchedToOtherCleaners: jest.fn().mockResolvedValue(undefined),
    };
    idempotency = {
      runOnce: jest.fn(async (_u: string, _op: string, _k: string, work: () => Promise<unknown>) =>
        work(),
      ),
    };

    const pricing = new NegotiationPricingService(new CommissionService());

    service = new NegotiationService(
      offerMatch as never,
      commissionRates as never,
      offerRepo as never,
      negotiationRepo as never,
      pricing,
      publisher as never,
      idempotency as never,
    );
  });

  describe('acceptOffer (direct accept)', () => {
    it('matches via the contract with source negotiation and returns a summary', async () => {
      const result = await service.acceptOffer('cleaner-1', 'offer-1', 'key-1');

      expect(offerMatch.match).toHaveBeenCalledWith('offer-1', 'cleaner-1', 'negotiation');
      expect(result.agreedPriceCents).toBe(BASE_PRICE);
      expect(result.cleanerPayoutCents).toBe(BASE_PRICE - Math.trunc((BASE_PRICE * CLEANER_RATE_BPS) / 10000));
    });

    it('resolves the winning Cleaner rate at match and snapshots it (two-moment resolution)', async () => {
      await service.acceptOffer('cleaner-1', 'offer-1', 'key-1');

      expect(commissionRates.resolveCleanerRate).toHaveBeenCalledWith({
        country: 'US',
        cleanerId: 'cleaner-1',
        serviceType: undefined,
      });
      expect(negotiationRepo.persistMatchedCleanerRate).toHaveBeenCalledWith(
        expect.objectContaining({ offerId: 'offer-1', cleanerCommissionRateBps: CLEANER_RATE_BPS }),
      );
    });

    it('applies a reduced PRO Cleaner rate resolved at match to the payout', async () => {
      commissionRates.resolveCleanerRate.mockResolvedValue({ rateBps: 100, ruleId: 'pro-c' });
      const result = await service.acceptOffer('cleaner-1', 'offer-1', 'key-1');
      // payout uses the resolved 100 bps, not the offer snapshot 300 bps
      expect(result.cleanerPayoutCents).toBe(BASE_PRICE - Math.trunc((BASE_PRICE * 100) / 10000));
    });

    it('Property P8: rejects when the offer is not ACTIVE', async () => {
      offerRepo.findOne.mockResolvedValue(makeOffer({ state: OfferState.MATCHED }));
      await expect(service.acceptOffer('cleaner-1', 'offer-1', 'key-1')).rejects.toThrow(
        ConflictException,
      );
      expect(offerMatch.match).not.toHaveBeenCalled();
    });

    it('Property P7: rejects when the Cleaner has no SENT delivery', async () => {
      negotiationRepo.hasSentDelivery.mockResolvedValue(false);
      await expect(service.acceptOffer('cleaner-1', 'offer-1', 'key-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(offerMatch.match).not.toHaveBeenCalled();
    });

    it('Property P1: returns conflict when the contract reports the offer is no longer ACTIVE', async () => {
      offerMatch.match.mockResolvedValue({ success: false, reason: 'not active' });
      await expect(service.acceptOffer('cleaner-1', 'offer-1', 'key-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('supersedes the Cleaner own PENDING counteroffer with DIRECT_ACCEPT', async () => {
      negotiationRepo.findThread.mockResolvedValue(makeThread());
      negotiationRepo.listProposals.mockResolvedValue([makeProposal()]);

      await service.acceptOffer('cleaner-1', 'offer-1', 'key-1');

      expect(negotiationRepo.setProposalStatus).toHaveBeenCalledWith(
        'proposal-1',
        ProposalStatus.SUPERSEDED,
        expect.objectContaining({ supersededReason: SupersededReason.DIRECT_ACCEPT }),
      );
    });

    it('Property P9: idempotency wrapper is invoked with the accept_offer operation', async () => {
      await service.acceptOffer('cleaner-1', 'offer-1', 'key-1');
      expect(idempotency.runOnce).toHaveBeenCalledWith(
        'cleaner-1',
        'accept_offer',
        'key-1',
        expect.any(Function),
      );
    });
  });

  describe('createCounteroffer', () => {
    it('inserts a PENDING proposal and publishes to the Host channel', async () => {
      const result = await service.createCounteroffer(
        'cleaner-1',
        'offer-1',
        { proposedPriceCents: 9000 },
        'key-2',
      );

      expect(negotiationRepo.insertProposalLocked).toHaveBeenCalled();
      expect(publisher.publishProposalCreatedToHost).toHaveBeenCalled();
      expect(result.status).toBe(ProposalStatus.PENDING);
    });

    it('Property P11: rejects a price outside the Base Price deviation bounds', async () => {
      await expect(
        service.createCounteroffer('cleaner-1', 'offer-1', { proposedPriceCents: 1 }, 'key-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the thread reached the max proposals budget', async () => {
      negotiationRepo.getOrCreateThread.mockResolvedValue(makeThread({ proposalCount: 6 }));
      await expect(
        service.createCounteroffer('cleaner-1', 'offer-1', { proposedPriceCents: 9500 }, 'key-2'),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('acceptProposal', () => {
    it('Property P7: Host can accept a CLEANER proposal', async () => {
      negotiationRepo.findProposalById.mockResolvedValue(makeProposal({ actor: ProposalActor.CLEANER }));
      const result = await service.acceptProposal('host-1', 'proposal-1', 'key-3');
      expect(offerMatch.match).toHaveBeenCalledWith('offer-1', 'cleaner-1', 'negotiation');
      expect(result.matchedProposalId).toBe('proposal-1');
      expect(negotiationRepo.markProposalAccepted).toHaveBeenCalledWith('proposal-1');
    });

    it('Property P7: a Cleaner cannot accept a CLEANER proposal (their own actor)', async () => {
      negotiationRepo.findProposalById.mockResolvedValue(makeProposal({ actor: ProposalActor.CLEANER }));
      await expect(service.acceptProposal('cleaner-1', 'proposal-1', 'key-3')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Property P7: Cleaner can accept a HOST proposal', async () => {
      negotiationRepo.findProposalById.mockResolvedValue(makeProposal({ actor: ProposalActor.HOST }));
      const result = await service.acceptProposal('cleaner-1', 'proposal-1', 'key-3');
      expect(result.matchedProposalId).toBe('proposal-1');
    });

    it('rejects accepting a non-PENDING proposal (conflict)', async () => {
      negotiationRepo.findProposalById.mockResolvedValue(
        makeProposal({ status: ProposalStatus.COUNTERED }),
      );
      await expect(service.acceptProposal('host-1', 'proposal-1', 'key-3')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('rejectProposal', () => {
    it('sets the proposal REJECTED and publishes', async () => {
      negotiationRepo.findProposalById.mockResolvedValue(makeProposal({ actor: ProposalActor.CLEANER }));
      await service.rejectProposal('host-1', 'proposal-1', 'key-4');
      expect(negotiationRepo.setProposalStatus).toHaveBeenCalledWith(
        'proposal-1',
        ProposalStatus.REJECTED,
        expect.objectContaining({ markResponded: true }),
      );
      expect(publisher.publishProposalRejected).toHaveBeenCalled();
    });
  });

  describe('counterProposal', () => {
    it('marks prior proposal COUNTERED and inserts a new HOST proposal when Host counters a Cleaner', async () => {
      negotiationRepo.findProposalById.mockResolvedValue(makeProposal({ actor: ProposalActor.CLEANER }));
      negotiationRepo.insertProposalLocked.mockResolvedValue({
        proposal: makeProposal({ id: 'proposal-2', actor: ProposalActor.HOST, sequenceNumber: 2 }),
        threadVersion: 2,
      });

      const result = await service.counterProposal(
        'host-1',
        'proposal-1',
        { proposedPriceCents: 9500 },
        'key-5',
      );

      expect(negotiationRepo.markProposalCountered).toHaveBeenCalledWith('proposal-1');
      expect(publisher.publishProposalCounteredToCleaner).toHaveBeenCalled();
      expect(result.id).toBe('proposal-2');
    });
  });
});

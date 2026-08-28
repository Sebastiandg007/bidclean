import {
  Injectable,
  Inject,
  Logger,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OFFER_MATCH, OfferMatchInterface } from '../offers/contracts/offer-match.interface';
import { Offer } from '../offers/entities/offer.entity';
import { OfferState } from '../offers/offers.types';
import { NegotiationRepository } from './negotiation.repository';
import { NegotiationPricingService } from './pricing/negotiation-pricing.service';
import { NegotiationPublisher } from './events/negotiation-publisher.service';
import { NegotiationIdempotencyService } from './negotiation-idempotency.service';
import { NEGOTIATION_CHANNELS, NEGOTIATION_MAX_PROPOSALS_PER_THREAD, NEGOTIATION_RESPONSE_WINDOW_MS } from './negotiation.constants';
import { NEGOTIATION_ERROR_MESSAGES } from './negotiation.messages';
import {
  ProposalActor,
  ProposalStatus,
  SupersededReason,
  NegotiationOperation,
  MatchSummary,
  ProposalView,
  ThreadView,
  HostInboxItem,
} from './negotiation.types';
import { NegotiationThread } from './entities/negotiation-thread.entity';
import { NegotiationProposal } from './entities/negotiation-proposal.entity';

/** DTO shape for a price proposal (Cleaner counteroffer or Host counter-back) */
interface PriceProposalInput {
  readonly proposedPriceCents: number;
}

/** The match source string required by the OfferMatchContract for negotiation matches */
const MATCH_SOURCE_NEGOTIATION = 'negotiation';

/**
 * Negotiation service (orchestration layer).
 *
 * Coordinates: idempotency check -> authorization + offer-state gate + delivery
 * revalidation -> atomic DB mutation -> match via the OfferMatchContract when
 * accepting -> best-effort real-time publish. It NEVER writes the `offers` table
 * directly; ACTIVE -> MATCHED happens exclusively through `OFFER_MATCH`.
 *
 * On a successful match, the service marks only the WINNING proposal ACCEPTED;
 * superseding every other PENDING proposal for the offer is delegated to the
 * single authority, `OfferTerminalListener` (reacting to `offer.matched`).
 */
@Injectable()
export class NegotiationService {
  private readonly logger = new Logger(NegotiationService.name);

  constructor(
    @Inject(OFFER_MATCH)
    private readonly offerMatch: OfferMatchInterface,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    private readonly negotiationRepo: NegotiationRepository,
    private readonly pricing: NegotiationPricingService,
    private readonly publisher: NegotiationPublisher,
    private readonly idempotency: NegotiationIdempotencyService,
  ) {}

  /**
   * Direct acceptance by a Cleaner at the Host's Base Price.
   * Revalidates, matches via contract, marks/creates the winning proposal ACCEPTED,
   * supersedes the Cleaner's own PENDING proposal (DIRECT_ACCEPT), and publishes.
   */
  async acceptOffer(
    cleanerId: string,
    offerId: string,
    idempotencyKey: string,
  ): Promise<MatchSummary> {
    return this.idempotency.runOnce(
      cleanerId,
      NegotiationOperation.ACCEPT_OFFER,
      idempotencyKey,
      async () => {
        const offer = await this.loadActiveOffer(offerId);
        await this.assertSentDelivery(offerId, cleanerId);

        const match = await this.offerMatch.match(offerId, cleanerId, MATCH_SOURCE_NEGOTIATION);
        if (!match.success) {
          throw new ConflictException(match.reason ?? NEGOTIATION_ERROR_MESSAGES.OFFER_UNAVAILABLE);
        }

        // Supersede the Cleaner's own open counteroffer, if any (direct accept wins).
        const thread = await this.negotiationRepo.findThread(offerId, offer.hostId, cleanerId);
        // Direct accept is at the Host's Base Price, not via a proposal, so no
        // proposal is the "match"; the Cleaner's own counteroffer (if any) is
        // superseded below rather than accepted.
        const matchedProposalId: string | null = null;
        if (thread) {
          const proposals = await this.negotiationRepo.listProposals(thread.id);
          const pending = proposals.find((p) => p.status === ProposalStatus.PENDING);
          if (pending) {
            await this.negotiationRepo.setProposalStatus(pending.id, ProposalStatus.SUPERSEDED, {
              supersededReason: SupersededReason.DIRECT_ACCEPT,
              markResponded: true,
            });
          }
        }

        const breakdown = this.pricing.computeBreakdown(offer, offer.offeredPriceCents);
        await this.publishMatchToOthers(offerId, cleanerId);

        this.logger.log(`Direct accept matched offer ${offerId} to cleaner ${cleanerId}`);

        return {
          offerId,
          cleanerId,
          agreedPriceCents: offer.offeredPriceCents,
          cleanerPayoutCents: breakdown.cleanerPayoutCents,
          hostTotalCents: breakdown.hostTotalCents,
          currency: offer.currency,
          matchedProposalId,
        };
      },
    );
  }

  /**
   * Cleaner submits a counteroffer. Revalidates ACTIVE + SENT delivery, enforces
   * Base Price deviation bounds and the max-proposals limit, then inserts a PENDING
   * CLEANER-actor proposal and publishes to the Host channel.
   */
  async createCounteroffer(
    cleanerId: string,
    offerId: string,
    input: PriceProposalInput,
    idempotencyKey: string,
  ): Promise<ProposalView> {
    return this.idempotency.runOnce(
      cleanerId,
      NegotiationOperation.CREATE_COUNTEROFFER,
      idempotencyKey,
      async () => {
        const offer = await this.loadActiveOffer(offerId);
        await this.assertSentDelivery(offerId, cleanerId);
        this.assertWithinBounds(offer.offeredPriceCents, input.proposedPriceCents);

        const thread = await this.negotiationRepo.getOrCreateThread({
          offerId,
          hostId: offer.hostId,
          cleanerId,
          basePriceCents: offer.offeredPriceCents,
          currency: offer.currency,
        });

        this.assertProposalBudget(thread);

        const proposal = await this.insertProposal(
          offer,
          thread,
          ProposalActor.CLEANER,
          input.proposedPriceCents,
        );

        await this.publisher.publishProposalCreatedToHost(offer.hostId, {
          threadId: thread.id,
          proposalId: proposal.proposal.id,
          offerId,
          version: proposal.threadVersion,
          sequenceNumber: proposal.proposal.sequenceNumber,
        });

        return this.toProposalView(proposal.proposal, offerId);
      },
    );
  }

  /**
   * Accept a counterparty PENDING proposal. Authorizes the counterparty rule,
   * revalidates ACTIVE + proposal PENDING, marks it ACCEPTED, matches via contract,
   * and publishes. Superseding other proposals is handled by the terminal listener.
   */
  async acceptProposal(
    userId: string,
    proposalId: string,
    idempotencyKey: string,
  ): Promise<MatchSummary> {
    return this.idempotency.runOnce(
      userId,
      NegotiationOperation.ACCEPT_PROPOSAL,
      idempotencyKey,
      async () => {
        const { proposal, thread, offer } = await this.loadProposalContext(proposalId);
        this.assertOfferActive(offer);
        this.assertProposalPending(proposal);
        this.assertCanAcceptCounterparty(userId, proposal, thread);

        const match = await this.offerMatch.match(
          offer.id,
          thread.cleanerId,
          MATCH_SOURCE_NEGOTIATION,
        );
        if (!match.success) {
          throw new ConflictException(match.reason ?? NEGOTIATION_ERROR_MESSAGES.OFFER_UNAVAILABLE);
        }

        await this.negotiationRepo.markProposalAccepted(proposal.id);

        const acceptedChannel =
          proposal.actor === ProposalActor.CLEANER
            ? NEGOTIATION_CHANNELS.cleaner(thread.cleanerId)
            : NEGOTIATION_CHANNELS.host(thread.hostId);
        await this.publisher.publishProposalAccepted(acceptedChannel, {
          threadId: thread.id,
          proposalId: proposal.id,
          offerId: offer.id,
          version: thread.version,
          sequenceNumber: proposal.sequenceNumber,
        });
        await this.publishMatchToOthers(offer.id, thread.cleanerId);

        return {
          offerId: offer.id,
          cleanerId: thread.cleanerId,
          agreedPriceCents: proposal.proposedPriceCents,
          cleanerPayoutCents: proposal.cleanerPayoutCents,
          hostTotalCents: proposal.hostTotalCents,
          currency: proposal.currency,
          matchedProposalId: proposal.id,
        };
      },
    );
  }

  /** Reject a counterparty PENDING proposal; leaves the offer ACTIVE. */
  async rejectProposal(
    userId: string,
    proposalId: string,
    idempotencyKey: string,
  ): Promise<ProposalView> {
    return this.idempotency.runOnce(
      userId,
      NegotiationOperation.REJECT_PROPOSAL,
      idempotencyKey,
      async () => {
        const { proposal, thread, offer } = await this.loadProposalContext(proposalId);
        this.assertOfferActive(offer);
        this.assertProposalPending(proposal);
        this.assertCanAcceptCounterparty(userId, proposal, thread);

        await this.negotiationRepo.setProposalStatus(proposal.id, ProposalStatus.REJECTED, {
          markResponded: true,
        });

        // Notify the proposal's author (the counterparty of the rejector).
        const rejectedChannel =
          proposal.actor === ProposalActor.CLEANER
            ? NEGOTIATION_CHANNELS.cleaner(thread.cleanerId)
            : NEGOTIATION_CHANNELS.host(thread.hostId);
        await this.publisher.publishProposalRejected(rejectedChannel, {
          threadId: thread.id,
          proposalId: proposal.id,
          offerId: offer.id,
          version: thread.version,
          sequenceNumber: proposal.sequenceNumber,
        });

        const refreshed = await this.negotiationRepo.findProposalById(proposal.id);
        return this.toProposalView(refreshed ?? proposal, offer.id);
      },
    );
  }

  /**
   * Counter back with a new price. Sets the prior PENDING proposal to COUNTERED and
   * inserts a new PENDING proposal authored by the countering actor.
   */
  async counterProposal(
    userId: string,
    proposalId: string,
    input: PriceProposalInput,
    idempotencyKey: string,
  ): Promise<ProposalView> {
    return this.idempotency.runOnce(
      userId,
      NegotiationOperation.COUNTER_PROPOSAL,
      idempotencyKey,
      async () => {
        const { proposal, thread, offer } = await this.loadProposalContext(proposalId);
        this.assertOfferActive(offer);
        this.assertProposalPending(proposal);
        const counteringActor = this.resolveCounteringActor(userId, proposal, thread);
        this.assertWithinBounds(thread.basePriceCents, input.proposedPriceCents);
        this.assertProposalBudget(thread);

        await this.negotiationRepo.markProposalCountered(proposal.id);

        const inserted = await this.insertProposal(
          offer,
          thread,
          counteringActor,
          input.proposedPriceCents,
        );

        // Notify the counterparty of the countering actor.
        if (counteringActor === ProposalActor.HOST) {
          await this.publisher.publishProposalCounteredToCleaner(thread.cleanerId, {
            threadId: thread.id,
            proposalId: inserted.proposal.id,
            offerId: offer.id,
            version: inserted.threadVersion,
            sequenceNumber: inserted.proposal.sequenceNumber,
          });
        } else {
          await this.publisher.publishProposalCreatedToHost(thread.hostId, {
            threadId: thread.id,
            proposalId: inserted.proposal.id,
            offerId: offer.id,
            version: inserted.threadVersion,
            sequenceNumber: inserted.proposal.sequenceNumber,
          });
        }

        return this.toProposalView(inserted.proposal, offer.id);
      },
    );
  }

  /** Fetch the Cleaner's own thread for an offer (ordered proposals). */
  async getThreadForCleaner(cleanerId: string, offerId: string): Promise<ThreadView | null> {
    const offer = await this.offerRepo.findOne({ where: { id: offerId } });
    if (!offer) {
      return null;
    }
    const thread = await this.negotiationRepo.findThread(offerId, offer.hostId, cleanerId);
    if (!thread) {
      return null;
    }
    const proposals = await this.negotiationRepo.listProposals(thread.id);
    return this.toThreadView(thread, proposals);
  }

  /** Fetch the Host inbox of PENDING Cleaner counteroffers across the Host's ACTIVE offers. */
  async getHostInbox(hostId: string): Promise<HostInboxItem[]> {
    const rows = await this.negotiationRepo.findHostInbox(hostId);
    return rows.map((row) => ({
      offerId: row.offer_id,
      propertyName: row.property_name_snapshot,
      cleaner: { cleanerId: row.cleaner_id, fullName: row.cleaner_full_name },
      proposal: {
        id: row.proposal_id,
        threadId: row.thread_id,
        offerId: row.offer_id,
        actor: row.actor as ProposalActor,
        sequenceNumber: row.sequence_number,
        proposedPriceCents: row.proposed_price_cents,
        cleanerPayoutCents: row.cleaner_payout_cents,
        hostTotalCents: row.host_total_cents,
        currency: row.currency,
        status: row.status as ProposalStatus,
        expiresAt: row.expires_at.toISOString(),
        createdAt: row.created_at.toISOString(),
      },
    }));
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Load an offer and assert it is ACTIVE. */
  private async loadActiveOffer(offerId: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({ where: { id: offerId } });
    if (!offer) {
      throw new ConflictException(NEGOTIATION_ERROR_MESSAGES.OFFER_UNAVAILABLE);
    }
    this.assertOfferActive(offer);
    return offer;
  }

  private assertOfferActive(offer: Offer): void {
    if (offer.state !== OfferState.ACTIVE) {
      throw new ConflictException(NEGOTIATION_ERROR_MESSAGES.OFFER_NOT_ACTIVE);
    }
  }

  private async assertSentDelivery(offerId: string, cleanerId: string): Promise<void> {
    const hasDelivery = await this.negotiationRepo.hasSentDelivery(offerId, cleanerId);
    if (!hasDelivery) {
      throw new ForbiddenException(NEGOTIATION_ERROR_MESSAGES.NO_SENT_DELIVERY);
    }
  }

  private assertWithinBounds(basePriceCents: number, proposedPriceCents: number): void {
    if (!this.pricing.isWithinDeviationBounds(basePriceCents, proposedPriceCents)) {
      const range = this.pricing.getDeviationRange(basePriceCents);
      throw new BadRequestException(
        `${NEGOTIATION_ERROR_MESSAGES.PRICE_OUT_OF_BOUNDS} [${range.minPriceCents}, ${range.maxPriceCents}]`,
      );
    }
  }

  private assertProposalBudget(thread: NegotiationThread): void {
    if (thread.proposalCount >= NEGOTIATION_MAX_PROPOSALS_PER_THREAD) {
      throw new UnprocessableEntityException(NEGOTIATION_ERROR_MESSAGES.MAX_PROPOSALS_REACHED);
    }
  }

  private assertProposalPending(proposal: NegotiationProposal): void {
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new ConflictException(NEGOTIATION_ERROR_MESSAGES.PROPOSAL_NOT_PENDING);
    }
  }

  /**
   * Assert the acting user may accept/reject the proposal: they must be the
   * counterparty (a Host acts on a CLEANER proposal; a Cleaner acts on a HOST
   * proposal), never their own actor.
   */
  private assertCanAcceptCounterparty(
    userId: string,
    proposal: NegotiationProposal,
    thread: NegotiationThread,
  ): void {
    if (proposal.actor === ProposalActor.CLEANER) {
      // Only the Host (offer owner) may act on a Cleaner proposal.
      if (userId !== thread.hostId) {
        throw new ForbiddenException(NEGOTIATION_ERROR_MESSAGES.NOT_COUNTERPARTY);
      }
    } else {
      // Only the Cleaner may act on a Host proposal.
      if (userId !== thread.cleanerId) {
        throw new ForbiddenException(NEGOTIATION_ERROR_MESSAGES.NOT_COUNTERPARTY);
      }
    }
  }

  /** Resolve which actor is countering (the counterparty of the current proposal's author). */
  private resolveCounteringActor(
    userId: string,
    proposal: NegotiationProposal,
    thread: NegotiationThread,
  ): ProposalActor {
    this.assertCanAcceptCounterparty(userId, proposal, thread);
    return proposal.actor === ProposalActor.CLEANER ? ProposalActor.HOST : ProposalActor.CLEANER;
  }

  /** Load a proposal with its thread and offer, or fail with a conflict. */
  private async loadProposalContext(
    proposalId: string,
  ): Promise<{ proposal: NegotiationProposal; thread: NegotiationThread; offer: Offer }> {
    const proposal = await this.negotiationRepo.findProposalById(proposalId);
    if (!proposal) {
      throw new ConflictException(NEGOTIATION_ERROR_MESSAGES.PROPOSAL_NOT_FOUND);
    }
    const thread = await this.negotiationRepo.findThreadById(proposal.threadId);
    if (!thread) {
      throw new ConflictException(NEGOTIATION_ERROR_MESSAGES.PROPOSAL_NOT_FOUND);
    }
    const offer = await this.offerRepo.findOne({ where: { id: thread.offerId } });
    if (!offer) {
      throw new ConflictException(NEGOTIATION_ERROR_MESSAGES.OFFER_UNAVAILABLE);
    }
    return { proposal, thread, offer };
  }

  /** Insert a proposal with computed breakdown and a fresh expires_at. */
  private async insertProposal(
    offer: Offer,
    thread: NegotiationThread,
    actor: ProposalActor,
    proposedPriceCents: number,
  ): Promise<{ proposal: NegotiationProposal; threadVersion: number }> {
    const breakdown = this.pricing.computeBreakdown(offer, proposedPriceCents);
    const expiresAt = new Date(Date.now() + NEGOTIATION_RESPONSE_WINDOW_MS);

    return this.negotiationRepo.insertProposalLocked({
      threadId: thread.id,
      actor,
      proposedPriceCents,
      cleanerPayoutCents: breakdown.cleanerPayoutCents,
      hostTotalCents: breakdown.hostTotalCents,
      currency: offer.currency,
      expiresAt,
    });
  }

  /** Publish offer_status_changed{MATCHED} to other delivered Cleaners' radar channels. */
  private async publishMatchToOthers(offerId: string, winnerCleanerId: string): Promise<void> {
    const others = await this.negotiationRepo.findOtherDeliveredCleaners(offerId, winnerCleanerId);
    await this.publisher.publishOfferMatchedToOtherCleaners(others, offerId);
  }

  private toProposalView(proposal: NegotiationProposal, offerId: string): ProposalView {
    return {
      id: proposal.id,
      threadId: proposal.threadId,
      offerId,
      actor: proposal.actor as ProposalActor,
      sequenceNumber: proposal.sequenceNumber,
      proposedPriceCents: proposal.proposedPriceCents,
      cleanerPayoutCents: proposal.cleanerPayoutCents,
      hostTotalCents: proposal.hostTotalCents,
      currency: proposal.currency,
      status: proposal.status as ProposalStatus,
      expiresAt: proposal.expiresAt.toISOString(),
      createdAt: proposal.createdAt.toISOString(),
    };
  }

  private toThreadView(thread: NegotiationThread, proposals: NegotiationProposal[]): ThreadView {
    return {
      id: thread.id,
      offerId: thread.offerId,
      hostId: thread.hostId,
      cleanerId: thread.cleanerId,
      status: thread.status as ThreadView['status'],
      basePriceCents: thread.basePriceCents,
      currency: thread.currency,
      version: thread.version,
      proposalCount: thread.proposalCount,
      proposals: proposals.map((p) => this.toProposalView(p, thread.offerId)),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NegotiationThread } from './entities/negotiation-thread.entity';
import { NegotiationProposal } from './entities/negotiation-proposal.entity';
import {
  ProposalActor,
  ProposalStatus,
  SupersededReason,
  ThreadStatus,
  HostInboxRow,
} from './negotiation.types';

/** Parameters to insert a new proposal within a locked thread transaction */
export interface InsertProposalParams {
  readonly threadId: string;
  readonly actor: ProposalActor;
  readonly proposedPriceCents: number;
  readonly cleanerPayoutCents: number;
  readonly hostTotalCents: number;
  readonly currency: string;
  readonly expiresAt: Date;
}

/** Result of a proposal insert (includes the allocated sequence + new thread version) */
export interface InsertProposalResult {
  readonly proposal: NegotiationProposal;
  readonly threadVersion: number;
}

/**
 * Negotiation repository.
 *
 * Owns all reads/writes to `negotiation_threads` and `negotiation_proposals`.
 * Uses parameterized SQL and, for proposal creation, a transaction that locks
 * the thread row with `SELECT ... FOR UPDATE` before allocating a strictly
 * increasing sequence_number and bumping proposal_count/version. It NEVER writes
 * the `offers` table (matching goes through the OfferMatchContract in the service).
 */
@Injectable()
export class NegotiationRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Find a thread by (offer, host, cleaner). */
  async findThread(
    offerId: string,
    hostId: string,
    cleanerId: string,
  ): Promise<NegotiationThread | null> {
    return this.dataSource.getRepository(NegotiationThread).findOne({
      where: { offerId, hostId, cleanerId },
    });
  }

  /** Find a thread by id. */
  async findThreadById(threadId: string): Promise<NegotiationThread | null> {
    return this.dataSource.getRepository(NegotiationThread).findOne({ where: { id: threadId } });
  }

  /** Find a proposal by id. */
  async findProposalById(proposalId: string): Promise<NegotiationProposal | null> {
    return this.dataSource
      .getRepository(NegotiationProposal)
      .findOne({ where: { id: proposalId } });
  }

  /** List proposals for a thread ordered by sequence ascending. */
  async listProposals(threadId: string): Promise<NegotiationProposal[]> {
    return this.dataSource.getRepository(NegotiationProposal).find({
      where: { threadId },
      order: { sequenceNumber: 'ASC' },
    });
  }

  /**
   * Get or create the single thread for (offer, host, cleaner). The base price is
   * snapshotted at creation and never changes afterward.
   */
  async getOrCreateThread(params: {
    offerId: string;
    hostId: string;
    cleanerId: string;
    basePriceCents: number;
    currency: string;
  }): Promise<NegotiationThread> {
    const existing = await this.findThread(params.offerId, params.hostId, params.cleanerId);
    if (existing) {
      return existing;
    }

    const repo = this.dataSource.getRepository(NegotiationThread);
    const thread = repo.create({
      offerId: params.offerId,
      hostId: params.hostId,
      cleanerId: params.cleanerId,
      status: ThreadStatus.OPEN,
      currentProposalId: null,
      proposalCount: 0,
      version: 0,
      basePriceCents: params.basePriceCents,
      currency: params.currency,
    });
    return repo.save(thread);
  }

  /**
   * Insert a new PENDING proposal within a transaction that locks the thread row.
   *
   * Locks the thread FOR UPDATE, allocates sequence_number = proposal_count + 1,
   * bumps proposal_count and version, inserts the proposal, and updates
   * current_proposal_id. The partial unique index guarantees at most one PENDING
   * proposal per thread; a concurrent insert will fail the unique constraint.
   *
   * @param params - Proposal fields (payout already computed by the pricing service)
   * @returns The inserted proposal and the new thread version
   */
  async insertProposalLocked(params: InsertProposalParams): Promise<InsertProposalResult> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Lock the thread row to serialize sequence/version allocation
      const lockedRows = await manager.query<
        { proposal_count: number; version: number }[]
      >(
        `SELECT "proposal_count", "version" FROM "negotiation_threads" WHERE "id" = $1 FOR UPDATE`,
        [params.threadId],
      );

      const locked = lockedRows[0];
      if (!locked) {
        throw new Error(`Thread ${params.threadId} not found for proposal insert`);
      }

      const currentCount = locked.proposal_count;
      const currentVersion = locked.version;
      const nextSequence = currentCount + 1;
      const nextVersion = currentVersion + 1;

      const proposalRepo = manager.getRepository(NegotiationProposal);
      const proposal = proposalRepo.create({
        threadId: params.threadId,
        actor: params.actor,
        sequenceNumber: nextSequence,
        proposedPriceCents: params.proposedPriceCents,
        cleanerPayoutCents: params.cleanerPayoutCents,
        hostTotalCents: params.hostTotalCents,
        currency: params.currency,
        status: ProposalStatus.PENDING,
        supersededReason: null,
        expiresAt: params.expiresAt,
        respondedAt: null,
      });
      const saved = await proposalRepo.save(proposal);

      await manager.query(
        `UPDATE "negotiation_threads"
         SET "proposal_count" = $1, "version" = $2, "current_proposal_id" = $3, "updated_at" = NOW()
         WHERE "id" = $4`,
        [nextSequence, nextVersion, saved.id, params.threadId],
      );

      return { proposal: saved, threadVersion: nextVersion };
    });
  }

  /**
   * Mark the prior PENDING proposal as COUNTERED (used when the counterparty
   * counters back). Runs inside the same connection as the caller's flow.
   */
  async markProposalCountered(proposalId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "negotiation_proposals"
       SET "status" = 'COUNTERED', "responded_at" = NOW(), "updated_at" = NOW()
       WHERE "id" = $1 AND "status" = 'PENDING'`,
      [proposalId],
    );
  }

  /** Set a proposal to a terminal status with an optional responded_at timestamp. */
  async setProposalStatus(
    proposalId: string,
    status: ProposalStatus,
    options: { supersededReason?: SupersededReason; markResponded?: boolean } = {},
  ): Promise<void> {
    const respondedClause = options.markResponded ? `, "responded_at" = NOW()` : '';
    await this.dataSource.query(
      `UPDATE "negotiation_proposals"
       SET "status" = $1, "superseded_reason" = $2${respondedClause}, "updated_at" = NOW()
       WHERE "id" = $3 AND "status" = 'PENDING'`,
      [status, options.supersededReason ?? null, proposalId],
    );
  }

  /**
   * Supersede all PENDING proposals for an offer with the given reason.
   * Idempotent: only affects rows still in PENDING status.
   *
   * @returns The number of proposals superseded
   */
  async supersedePendingForOffer(offerId: string, reason: SupersededReason): Promise<number> {
    const result = await this.dataSource.query<{ id: string }[]>(
      `UPDATE "negotiation_proposals" p
       SET "status" = 'SUPERSEDED', "superseded_reason" = $1, "updated_at" = NOW()
       FROM "negotiation_threads" t
       WHERE p."thread_id" = t."id"
         AND t."offer_id" = $2
         AND p."status" = 'PENDING'
       RETURNING p."id"`,
      [reason, offerId],
    );
    return result.length;
  }

  /** Close all threads for an offer (offer became terminal). */
  async closeThreadsForOffer(offerId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "negotiation_threads"
       SET "status" = 'CLOSED', "updated_at" = NOW()
       WHERE "offer_id" = $1 AND "status" = 'OPEN'`,
      [offerId],
    );
  }

  /** Mark expired PENDING proposals whose response window has elapsed. Returns count. */
  async expireStalePendingProposals(): Promise<number> {
    const result = await this.dataSource.query<{ id: string }[]>(
      `UPDATE "negotiation_proposals"
       SET "status" = 'EXPIRED', "updated_at" = NOW()
       WHERE "status" = 'PENDING' AND "expires_at" < NOW()
       RETURNING "id"`,
    );
    return result.length;
  }

  /** Host inbox: PENDING CLEANER-actor proposals across the Host's ACTIVE offers. */
  async findHostInbox(hostId: string): Promise<HostInboxRow[]> {
    return this.dataSource.query<HostInboxRow[]>(
      `SELECT
         p."id" AS proposal_id,
         p."thread_id" AS thread_id,
         t."offer_id" AS offer_id,
         t."cleaner_id" AS cleaner_id,
         t."base_price_cents" AS base_price_cents,
         u."full_name" AS cleaner_full_name,
         o."property_name_snapshot" AS property_name_snapshot,
         o."host_service_fee_rate_bps" AS host_service_fee_rate_bps,
         o."cleaner_commission_rate_bps" AS cleaner_commission_rate_bps,
         p."actor" AS actor,
         p."sequence_number" AS sequence_number,
         p."proposed_price_cents" AS proposed_price_cents,
         p."cleaner_payout_cents" AS cleaner_payout_cents,
         p."host_total_cents" AS host_total_cents,
         p."currency" AS currency,
         p."status" AS status,
         p."expires_at" AS expires_at,
         p."created_at" AS created_at
       FROM "negotiation_proposals" p
       INNER JOIN "negotiation_threads" t ON t."id" = p."thread_id"
       INNER JOIN "offers" o ON o."id" = t."offer_id"
       LEFT JOIN "users" u ON u."id" = t."cleaner_id"
       WHERE t."host_id" = $1
         AND p."actor" = 'CLEANER'
         AND p."status" = 'PENDING'
         AND o."state" = 'ACTIVE'
       ORDER BY p."created_at" ASC`,
      [hostId],
    );
  }

  /**
   * The Cleaner who won a MATCHED offer, derived from the ACCEPTED proposal's
   * thread. Returns null when no ACCEPTED proposal exists (e.g. a direct accept
   * that created no proposal, or an offer matched outside negotiation).
   */
  async findMatchedCleanerId(offerId: string): Promise<string | null> {
    const rows = await this.dataSource.query<{ cleaner_id: string }[]>(
      `SELECT t."cleaner_id" AS cleaner_id
       FROM "negotiation_proposals" p
       INNER JOIN "negotiation_threads" t ON t."id" = p."thread_id"
       WHERE t."offer_id" = $1 AND p."status" = 'ACCEPTED'
       LIMIT 1`,
      [offerId],
    );
    return rows[0]?.cleaner_id ?? null;
  }

  /** Whether the Cleaner has a SENT delivery record for the offer. */
  async hasSentDelivery(offerId: string, cleanerId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM "offer_deliveries"
         WHERE "offer_id" = $1 AND "cleaner_id" = $2 AND "delivery_status" = 'SENT'
       ) AS exists`,
      [offerId, cleanerId],
    );
    return rows[0]?.exists === true;
  }

  /** Cleaner IDs (excluding the winner) who received the offer via a SENT delivery. */
  async findOtherDeliveredCleaners(offerId: string, winnerCleanerId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ cleaner_id: string }[]>(
      `SELECT DISTINCT "cleaner_id" FROM "offer_deliveries"
       WHERE "offer_id" = $1 AND "cleaner_id" IS NOT NULL AND "cleaner_id" <> $2 AND "delivery_status" = 'SENT'`,
      [offerId, winnerCleanerId],
    );
    return rows.map((r) => r.cleaner_id);
  }

  /** Threads whose offer is MATCHED but that still have a PENDING proposal (reconciliation). */
  async findThreadsNeedingReconciliation(): Promise<
    { offer_id: string; offer_state: string }[]
  > {
    return this.dataSource.query<{ offer_id: string; offer_state: string }[]>(
      `SELECT DISTINCT t."offer_id" AS offer_id, o."state" AS offer_state
       FROM "negotiation_proposals" p
       INNER JOIN "negotiation_threads" t ON t."id" = p."thread_id"
       INNER JOIN "offers" o ON o."id" = t."offer_id"
       WHERE p."status" = 'PENDING'
         AND o."state" IN ('MATCHED', 'CANCELLED', 'EXPIRED')`,
    );
  }

  /** Mark the winning proposal ACCEPTED and persist the agreed price/breakdown. */
  async markProposalAccepted(proposalId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "negotiation_proposals"
       SET "status" = 'ACCEPTED', "responded_at" = NOW(), "updated_at" = NOW()
       WHERE "id" = $1 AND "status" = 'PENDING'`,
      [proposalId],
    );
  }
}

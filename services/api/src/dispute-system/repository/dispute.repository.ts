import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { OutboxRow, writeOutbox } from '../../common/outbox/outbox-writer';
import {
  ACTIVE_DISPUTE_STATES,
  DisputeEvidenceKind,
  DisputeInitiatorRole,
  DisputePhase,
  DisputeResolution,
  DisputeState,
  EscrowIntentTarget,
  FinancialIntentAction,
  IntentStatus,
} from '../dispute.types';

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = '23505';

/** A raw dispute row (snake_case as stored). */
export interface DisputeRow {
  readonly id: string;
  readonly service_completion_id: string;
  readonly offer_id: string;
  readonly payment_id: string;
  readonly initiator_id: string | null;
  readonly initiator_role: string;
  readonly host_id: string | null;
  readonly cleaner_id: string | null;
  readonly phase: string;
  readonly reason_code: string;
  readonly reason_text: string | null;
  readonly state: string;
  readonly resolution: string | null;
  readonly resolution_refund_cents: number | null;
  readonly evidence_deadline: Date;
  readonly resolution_deadline: Date;
  readonly resolved_at: Date | null;
}

/** A typed upstream reference to auto-link at creation. */
export interface UpstreamReferenceSpec {
  readonly kind: DisputeEvidenceKind;
  readonly ref: string | null;
}

/** Parameters for the idempotent active-dispute creation. */
export interface CreateDisputeParams {
  readonly disputeId: string;
  readonly serviceCompletionId: string;
  readonly offerId: string;
  readonly paymentId: string;
  readonly initiatorId: string | null;
  readonly initiatorRole: DisputeInitiatorRole;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly phase: DisputePhase;
  readonly reasonCode: string;
  readonly reasonText: string | null;
  readonly evidenceDeadline: Date;
  readonly resolutionDeadline: Date;
  readonly references: readonly UpstreamReferenceSpec[];
}

/** The financial intent co-persisted with a terminal transition (exactly one). */
export interface FinancialIntentSpec {
  readonly paymentId: string;
  readonly action: FinancialIntentAction;
  readonly amountCents: number | null;
}

/** Derived fields set on a terminal transition. */
export interface TerminalFields {
  readonly resolution: DisputeResolution;
  readonly resolutionRefundCents: number | null;
  readonly resolvedBy: string;
}

/**
 * DisputeRepository (`disputes` + `dispute_outbox`, coordinates the intents + evidence links)
 * — parameterized SQL only (Spec 21).
 *
 * The money-safety guarantee is the SINGLE-WINNER conditional write: a transition is
 * `UPDATE ... WHERE id=:id AND state=:expected RETURNING ...`, so under N concurrent actors exactly
 * one observes rows=1 (the winner, which sets the derived fields AND — on resolve/expire — inserts
 * exactly one `dispute_financial_intent` AND writes the `dispute_outbox` row, all in ONE tx). Active
 * creation is idempotent under the partial-unique `uq_disputes_active_completion` (a concurrent /
 * redelivered create maps to a no-op).
 */
@Injectable()
export class DisputeRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Idempotent creation of the ACTIVE dispute. Serializes concurrent creates for the same completion
   * with a transaction-scoped advisory lock keyed by `service_completion_id`, then inserts the
   * dispute guarded by the partial-unique active constraint — a second active insert violates it and
   * maps to an idempotent no-op. Co-inserts the auto-linked upstream references + the `OPEN`
   * escrow-block intent + the `dispute_opened` outbox, all in ONE transaction. Returns the created
   * dispute id, or null when an active dispute already existed (no-op).
   */
  async createDisputeActive(
    params: CreateDisputeParams,
    openedOutbox: OutboxRow,
  ): Promise<string | null> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [params.serviceCompletionId]);

      const existing = await manager.query<Array<{ id: string }>>(
        `SELECT "id" FROM "disputes"
         WHERE "service_completion_id" = $1 AND "state" = ANY($2) LIMIT 1`,
        [params.serviceCompletionId, [...ACTIVE_DISPUTE_STATES]],
      );
      if (existing[0]) {
        return null; // an active dispute already exists — idempotent no-op
      }

      let inserted: Array<{ id: string }>;
      try {
        inserted = await manager.query<Array<{ id: string }>>(
          `INSERT INTO "disputes"
             ("service_completion_id", "offer_id", "payment_id", "initiator_id", "initiator_role",
              "host_id", "cleaner_id", "phase", "reason_code", "reason_text", "state",
              "evidence_deadline", "resolution_deadline")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING "id"`,
          [
            params.serviceCompletionId,
            params.offerId,
            params.paymentId,
            params.initiatorId,
            params.initiatorRole,
            params.hostId,
            params.cleanerId,
            params.phase,
            params.reasonCode,
            params.reasonText,
            DisputeState.OPEN,
            params.evidenceDeadline,
            params.resolutionDeadline,
          ],
        );
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          return null; // raced past the advisory lock somehow — still idempotent
        }
        throw error;
      }

      const disputeId = requireId(inserted[0]);

      for (const reference of params.references) {
        await manager.query(
          `INSERT INTO "dispute_evidence" ("dispute_id", "kind", "ref") VALUES ($1, $2, $3)`,
          [disputeId, reference.kind, reference.ref],
        );
      }

      await manager.query(
        `INSERT INTO "dispute_escrow_intents" ("dispute_id", "payment_id", "target", "status")
         VALUES ($1, $2, $3, $4)`,
        [disputeId, params.paymentId, EscrowIntentTarget.OPEN, IntentStatus.PENDING],
      );

      await writeOutbox(manager, { ...openedOutbox, aggregateId: disputeId });
      return disputeId;
    });
  }

  /**
   * Single-winner NON-terminal transition (e.g. OPEN → UNDER_REVIEW). Returns true for the winner.
   */
  async transitionState(
    id: string,
    expected: DisputeState,
    next: DisputeState,
  ): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE "disputes" SET "state" = $2, "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = $3
       RETURNING "id"`,
      [id, next, expected],
    );
    return rows[0] !== undefined;
  }

  /**
   * Single-winner TERMINAL transition (RESOLVED/EXPIRED): sets the derived fields, inserts EXACTLY
   * one `dispute_financial_intent`, and writes the `dispute_resolved` outbox — all in ONE tx. The
   * `WHERE state = ANY(active)` guard makes it single-winner; a loser observes rows=0 → no-op. The
   * escrow is NOT cleared here (clear-escrow-LAST). Returns true for the winner.
   */
  async transitionTerminal(
    id: string,
    next: DisputeState,
    fields: TerminalFields,
    financialIntent: FinancialIntentSpec,
    resolvedOutbox: OutboxRow,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `UPDATE "disputes"
         SET "state" = $2, "resolution" = $3, "resolution_refund_cents" = $4,
             "resolved_at" = NOW(), "resolved_by" = $5, "updated_at" = NOW()
         WHERE "id" = $1 AND "state" = ANY($6)
         RETURNING "id"`,
        [
          id,
          next,
          fields.resolution,
          fields.resolutionRefundCents,
          fields.resolvedBy,
          [...ACTIVE_DISPUTE_STATES],
        ],
      );
      if (rows[0] === undefined) {
        return false;
      }
      await manager.query(
        `INSERT INTO "dispute_financial_intents"
           ("dispute_id", "payment_id", "action", "amount_cents", "status")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("dispute_id") WHERE "dispute_id" IS NOT NULL DO NOTHING`,
        [
          id,
          financialIntent.paymentId,
          financialIntent.action,
          financialIntent.amountCents,
          IntentStatus.PENDING,
        ],
      );
      await writeOutbox(manager, resolvedOutbox);
      return true;
    });
  }

  /** Enqueue the `NONE` escrow-block clear intent (called only after the financial effect applied). */
  async enqueueClearIntent(disputeId: string | null, paymentId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "dispute_escrow_intents" ("dispute_id", "payment_id", "target", "status")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("dispute_id", "target") WHERE "dispute_id" IS NOT NULL DO NOTHING`,
      [disputeId, paymentId, EscrowIntentTarget.NONE, IntentStatus.PENDING],
    );
  }

  /** Load a dispute by id. */
  async findById(id: string): Promise<DisputeRow | null> {
    const rows = await this.dataSource.query<DisputeRow[]>(
      `${DISPUTE_SELECT} WHERE "id" = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** The active dispute for a completion, if any. */
  async findByCompletionActive(completionId: string): Promise<DisputeRow | null> {
    const rows = await this.dataSource.query<DisputeRow[]>(
      `${DISPUTE_SELECT} WHERE "service_completion_id" = $1 AND "state" = ANY($2) LIMIT 1`,
      [completionId, [...ACTIVE_DISPUTE_STATES]],
    );
    return rows[0] ?? null;
  }

  /** Non-terminal disputes past their snapshotted deadline (SLA sweep input). */
  async findDueForSla(now: Date, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "disputes"
       WHERE "state" = ANY($1) AND "resolution_deadline" <= $2
       ORDER BY "resolution_deadline" ASC
       LIMIT $3`,
      [[...ACTIVE_DISPUTE_STATES], now, limit],
    );
    return rows.map((row) => row.id);
  }

  /** Read-only cross-module resolution of the escrow payment + participants for an offer (Spec 9). */
  async resolvePaymentForOffer(
    offerId: string,
  ): Promise<{ paymentId: string; hostId: string; cleanerId: string } | null> {
    const rows = await this.dataSource.query<
      Array<{ id: string; host_id: string; cleaner_id: string }>
    >(
      `SELECT "id", "host_id", "cleaner_id" FROM "payments" WHERE "offer_id" = $1 LIMIT 1`,
      [offerId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { paymentId: row.id, hostId: row.host_id, cleanerId: row.cleaner_id };
  }

  /** Run a callback inside a transaction (for tests / composite flows). */
  async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(fn);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    );
  }
}

/** The projected dispute columns (single source for the reads). */
const DISPUTE_SELECT = `
  SELECT "id", "service_completion_id", "offer_id", "payment_id", "initiator_id", "initiator_role",
         "host_id", "cleaner_id", "phase", "reason_code", "reason_text", "state", "resolution",
         "resolution_refund_cents", "evidence_deadline", "resolution_deadline", "resolved_at"
  FROM "disputes"
`;

/** Require an inserted id. */
function requireId(row: { id: string } | undefined): string {
  if (!row) {
    throw new Error('Insert did not return an id');
  }
  return row.id;
}

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { OutboxRow, writeOutbox } from '../../common/outbox/outbox-writer';
import {
  CompletionReleaseReason,
  CompletionState,
  IntentStatus,
} from '../completion.types';

/** A raw completion row (snake_case as stored). */
export interface CompletionRow {
  readonly id: string;
  readonly service_session_id: string;
  readonly offer_id: string;
  readonly payment_id: string;
  readonly host_id: string | null;
  readonly cleaner_id: string | null;
  readonly state: string;
  readonly checklist_completed_at: Date;
  readonly auto_release_deadline: Date;
  readonly confirmed_at: Date | null;
  readonly released_trigger: string | null;
  readonly dispute_id: string | null;
  readonly post_release_dispute_id: string | null;
}

/** Params for idempotent completion creation. */
export interface CreateCompletionParams {
  readonly serviceSessionId: string;
  readonly offerId: string;
  readonly paymentId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly checklistCompletedAt: Date;
  readonly autoReleaseDeadline: Date;
}

/** Derived fields set on a release-bearing/dispute transition. */
export interface TransitionDerivedFields {
  readonly confirmedAt?: boolean;
  readonly releasedTrigger?: CompletionReleaseReason;
  readonly disputeId?: string;
}

/** A durable release intent to persist atomically with a release-bearing transition. */
export interface ReleaseIntentSpec {
  readonly paymentId: string;
  readonly reason: CompletionReleaseReason;
}

const COMPLETION_COLUMNS = `
  "id", "service_session_id", "offer_id", "payment_id", "host_id", "cleaner_id", "state",
  "checklist_completed_at", "auto_release_deadline", "confirmed_at", "released_trigger",
  "dispute_id", "post_release_dispute_id"
`;

/**
 * CompletionRepository (`service_completions` + `completion_outbox`, coordinates `release_intents`)
 * — parameterized SQL only (Spec 20).
 *
 * The authoritative money-safety guarantee is the SINGLE-WINNER conditional write: a transition is
 * `UPDATE ... WHERE id=:id AND state='AWAITING_CONFIRMATION' RETURNING ...`, so under N concurrent
 * actors exactly one observes rows=1 (the winner, which sets the derived fields AND — when
 * release-bearing — inserts exactly one `release_intent` AND writes the `completion_outbox` row in
 * the SAME transaction). `transitionPostReleaseDispute` gates on the release actually being
 * ACCEPTED (an `EXISTS` on an ACCEPTED intent), so the DECISION state is never mistaken for the
 * RELEASE EXECUTION state.
 */
@Injectable()
export class CompletionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Idempotent creation off the `checklist_completed` fact: `INSERT ... ON CONFLICT
   * (service_session_id) DO NOTHING`. Returns true when this call created the completion.
   */
  async createCompletion(params: CreateCompletionParams): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO "service_completions"
         ("service_session_id", "offer_id", "payment_id", "host_id", "cleaner_id", "state",
          "checklist_completed_at", "auto_release_deadline")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ("service_session_id") DO NOTHING
       RETURNING "id"`,
      [
        params.serviceSessionId,
        params.offerId,
        params.paymentId,
        params.hostId,
        params.cleanerId,
        CompletionState.AWAITING_CONFIRMATION,
        params.checklistCompletedAt,
        params.autoReleaseDeadline,
      ],
    );
    return rows[0] !== undefined;
  }

  /**
   * Single-winner transition: `UPDATE ... WHERE id=:id AND state='AWAITING_CONFIRMATION'` setting
   * the derived fields AND (when `intent` is given) inserting exactly one `release_intent` AND
   * writing the `completion_outbox` row(s), all in ONE transaction. Returns true for the winner.
   */
  async transition(
    id: string,
    next: CompletionState,
    derived: TransitionDerivedFields,
    intent: ReleaseIntentSpec | null,
    outbox: OutboxRow,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `UPDATE "service_completions"
         SET "state" = $2,
             "confirmed_at" = CASE WHEN $3 THEN COALESCE("confirmed_at", NOW()) ELSE "confirmed_at" END,
             "released_trigger" = COALESCE($4, "released_trigger"),
             "dispute_id" = COALESCE($5, "dispute_id"),
             "updated_at" = NOW()
         WHERE "id" = $1 AND "state" = $6
         RETURNING "id"`,
        [
          id,
          next,
          derived.confirmedAt === true,
          derived.releasedTrigger ?? null,
          derived.disputeId ?? null,
          CompletionState.AWAITING_CONFIRMATION,
        ],
      );
      if (rows[0] === undefined) {
        return false;
      }
      if (intent) {
        await manager.query(
          `INSERT INTO "release_intents" ("service_completion_id", "payment_id", "reason", "status")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("service_completion_id") DO NOTHING`,
          [id, intent.paymentId, intent.reason, IntentStatus.PENDING],
        );
      }
      await writeOutbox(manager, outbox);
      return true;
    });
  }

  /**
   * Post-release dispute: conditional write gated on the release actually being ACCEPTED. No state
   * change, no intent. Succeeds only when the completion is in a released decision state, has no
   * post-release dispute yet, AND an ACCEPTED intent exists (money moved). A matching decision state
   * with a still-PENDING/DISPATCHED intent → rows=0 → the service maps it to 409.
   */
  async transitionPostReleaseDispute(
    id: string,
    disputeId: string,
    outbox: OutboxRow,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `UPDATE "service_completions" c
         SET "post_release_dispute_id" = $2, "updated_at" = NOW()
         WHERE c."id" = $1
           AND c."state" IN ($3, $4)
           AND c."post_release_dispute_id" IS NULL
           AND EXISTS (
             SELECT 1 FROM "release_intents" i
             WHERE i."service_completion_id" = c."id" AND i."status" = $5
           )
         RETURNING c."id"`,
        [
          id,
          disputeId,
          CompletionState.CONFIRMED,
          CompletionState.AUTO_RELEASED,
          IntentStatus.ACCEPTED,
        ],
      );
      if (rows[0] === undefined) {
        return false;
      }
      await writeOutbox(manager, outbox);
      return true;
    });
  }

  /** Load a completion by id. */
  async findById(id: string): Promise<CompletionRow | null> {
    const rows = await this.dataSource.query<CompletionRow[]>(
      `SELECT ${COMPLETION_COLUMNS} FROM "service_completions" WHERE "id" = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Load a completion by its (unique) session id. */
  async findBySessionId(sessionId: string): Promise<CompletionRow | null> {
    const rows = await this.dataSource.query<CompletionRow[]>(
      `SELECT ${COMPLETION_COLUMNS} FROM "service_completions" WHERE "service_session_id" = $1 LIMIT 1`,
      [sessionId],
    );
    return rows[0] ?? null;
  }

  /**
   * AWAITING_CONFIRMATION completions whose snapshotted deadline has passed (auto-release sweep
   * input). Oldest-deadline-first, bounded (partial-index scan). `now` is passed for testability.
   */
  async findDueForAutoRelease(now: Date, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "service_completions"
       WHERE "state" = $1 AND "auto_release_deadline" <= $2
       ORDER BY "auto_release_deadline" ASC
       LIMIT $3`,
      [CompletionState.AWAITING_CONFIRMATION, now, limit],
    );
    return rows.map((row) => row.id);
  }

  /** Read-only cross-module resolution of the offer bound to a session. */
  async resolveOfferIdForSession(sessionId: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ offer_id: string }>>(
      `SELECT "offer_id" FROM "service_sessions" WHERE "id" = $1 LIMIT 1`,
      [sessionId],
    );
    return rows[0]?.offer_id ?? null;
  }

  /** Read-only cross-module resolution of the escrow payment + participants for an offer. */
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

  /** Whether the given side already has a rating for the completion (for the view). */
  async findRatedRoles(completionId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ role: string }>>(
      `SELECT "role" FROM "service_ratings" WHERE "service_completion_id" = $1`,
      [completionId],
    );
    return rows.map((row) => row.role);
  }

  /** Run a callback inside a transaction (for tests / composite flows). */
  async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(fn);
  }
}

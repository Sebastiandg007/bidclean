import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { OutboxRow, writeOutbox } from '../../common/outbox/outbox-writer';
import { Decision, FailureReason, VerificationState } from '../video-verification.types';

/** Raw `verification_sessions` row shape (snake_case) returned by parameterized queries. */
export interface VerificationRow {
  readonly id: string;
  readonly service_session_id: string;
  readonly offer_id: string;
  readonly cleaner_id: string | null;
  readonly host_id: string | null;
  readonly object_key: string | null;
  readonly state: string;
  readonly decision: string | null;
  readonly match_score: string | null;
  readonly match_threshold: string;
  readonly reference_source: string;
  readonly processing_attempt: number;
  readonly failure_reason: string | null;
  readonly uploaded_at: Date | null;
  readonly processed_at: Date | null;
  readonly video_deleted_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Parameters for the idempotent creation off the arrival fact. */
export interface CreateVerificationParams {
  readonly serviceSessionId: string;
  readonly offerId: string;
  readonly cleanerId: string | null;
  readonly hostId: string | null;
  readonly state: VerificationState;
  readonly matchThreshold: number;
}

/** Derived fields a terminal transition may set atomically with the state change. */
export interface TerminalDerivedFields {
  readonly decision?: Decision;
  readonly matchScore?: number;
  readonly failureReason?: FailureReason;
}

/** The full SELECT list, kept once so every read returns the same shape. */
const SELECT_COLUMNS = `
  "id", "service_session_id", "offer_id", "cleaner_id", "host_id", "object_key", "state",
  "decision", "match_score", "match_threshold", "reference_source", "processing_attempt",
  "failure_reason", "uploaded_at", "processed_at", "video_deleted_at", "created_at", "updated_at"
`;

/**
 * VerificationRepository (`verification_sessions` + `verification_outbox`) — parameterized SQL only
 * (Spec 18).
 *
 * The authoritative lifecycle guarantee is the SINGLE-WINNER conditional write: a transition is
 * `UPDATE ... WHERE id=:id AND state=:expected RETURNING ...`, so under N concurrent actors exactly
 * one observes `rowCount = 1` (the winner, which sets the derived fields AND writes the
 * `verification_outbox` row(s) in the SAME transaction for a decision-bearing terminal) and every
 * other observes `rowCount = 0` and no-ops. `beginProcessing`/`retryProcessing` each FUSE the
 * attempt increment with a controlled transition — there is NO state-independent attempt claim, so
 * only a transition winner ever bumps `processing_attempt`. `writeResultGuarded` applies a result
 * only when its attempt is the latest (stale-safe). The `match_score` is never logged.
 */
@Injectable()
export class VerificationRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Idempotent creation off the arrival fact: `INSERT ... ON CONFLICT (service_session_id) DO
   * NOTHING`. A redelivered/concurrent attempt is a no-op — `UNIQUE service_session_id` is the hard
   * guarantee. Returns the row for this session (freshly inserted or the pre-existing one).
   */
  async createFromArrival(params: CreateVerificationParams): Promise<VerificationRow> {
    await this.dataSource.query(
      `INSERT INTO "verification_sessions"
         ("service_session_id", "offer_id", "cleaner_id", "host_id", "state", "match_threshold")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("service_session_id") DO NOTHING`,
      [
        params.serviceSessionId,
        params.offerId,
        params.cleanerId,
        params.hostId,
        params.state,
        params.matchThreshold,
      ],
    );
    const row = await this.findByServiceSessionId(params.serviceSessionId);
    if (!row) {
      throw new Error('verification_sessions row missing immediately after upsert');
    }
    return row;
  }

  /** Load a verification by id (reconciliation / authorization). */
  async findById(id: string): Promise<VerificationRow | null> {
    const rows = await this.dataSource.query<VerificationRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "verification_sessions" WHERE "id" = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Load a verification by its (unique) service session id. */
  async findByServiceSessionId(serviceSessionId: string): Promise<VerificationRow | null> {
    const rows = await this.dataSource.query<VerificationRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "verification_sessions"
       WHERE "service_session_id" = $1 LIMIT 1`,
      [serviceSessionId],
    );
    return rows[0] ?? null;
  }

  /**
   * Single-winner `PENDING_UPLOAD → UPLOADED` transition: sets `object_key` + `uploaded_at`. Runs
   * inside the caller's finalize transaction (shared manager) so grant-consume + transition commit
   * atomically. Returns true when this caller won.
   */
  async markUploaded(manager: EntityManager, id: string, objectKey: string): Promise<boolean> {
    const rows = await manager.query<Array<{ id: string }>>(
      `UPDATE "verification_sessions"
       SET "state" = '${VerificationState.UPLOADED}', "object_key" = $2, "uploaded_at" = NOW(),
           "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = '${VerificationState.PENDING_UPLOAD}'
       RETURNING "id"`,
      [id, objectKey],
    );
    return rows.length > 0;
  }

  /**
   * The ONE atomic write that fuses `UPLOADED → PROCESSING` with the attempt increment. The single
   * winner receives the freshly-created attempt; concurrent losers get zero rows, no-op, and never
   * bump the counter. There is no state-independent attempt claim.
   */
  async beginProcessing(id: string): Promise<{ attempt: number } | null> {
    const rows = await this.dataSource.query<Array<{ processing_attempt: number }>>(
      `UPDATE "verification_sessions"
       SET "state" = '${VerificationState.PROCESSING}',
           "processing_attempt" = "processing_attempt" + 1,
           "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = '${VerificationState.UPLOADED}'
       RETURNING "processing_attempt"`,
      [id],
    );
    const row = rows[0];
    return row ? { attempt: row.processing_attempt } : null;
  }

  /**
   * The StuckProcessingSweep's explicit controlled retry FROM `PROCESSING`: bumps the attempt only
   * for a row stuck in PROCESSING before `stuckBefore`, invalidating the previous attempt and
   * creating the next one in one conditional write. Returns `null` (no bump) when not eligible.
   */
  async retryProcessing(id: string, stuckBefore: Date): Promise<{ attempt: number } | null> {
    const rows = await this.dataSource.query<Array<{ processing_attempt: number }>>(
      `UPDATE "verification_sessions"
       SET "processing_attempt" = "processing_attempt" + 1, "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = '${VerificationState.PROCESSING}' AND "updated_at" < $2
       RETURNING "processing_attempt"`,
      [id, stuckBefore],
    );
    const row = rows[0];
    return row ? { attempt: row.processing_attempt } : null;
  }

  /**
   * Apply a comparison result + `PROCESSING → terminal` transition ONLY IF `attempt` is the latest
   * `processing_attempt` (stale-update guard) — a slower older attempt is a no-op. Writes the
   * derived fields (`decision`/`match_score`/`failure_reason`/`processed_at`) AND, for a
   * decision-bearing terminal, the `verification_outbox` row(s) in ONE transaction. Returns true
   * when this attempt won.
   */
  async writeResultGuarded(
    id: string,
    attempt: number,
    next: VerificationState,
    derived: TerminalDerivedFields,
    outbox: OutboxRow[],
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `UPDATE "verification_sessions"
         SET "state" = $3,
             "decision" = COALESCE($4, "decision"),
             "match_score" = COALESCE($5, "match_score"),
             "failure_reason" = COALESCE($6, "failure_reason"),
             "processed_at" = NOW(),
             "updated_at" = NOW()
         WHERE "id" = $1 AND "state" = '${VerificationState.PROCESSING}'
           AND "processing_attempt" = $2
         RETURNING "id"`,
        [
          id,
          attempt,
          next,
          derived.decision ?? null,
          derived.matchScore ?? null,
          derived.failureReason ?? null,
        ],
      );
      if (rows.length === 0) {
        return false;
      }
      for (const row of outbox) {
        await writeOutbox(manager, row);
      }
      return true;
    });
  }

  /**
   * Single-winner `PENDING_UPLOAD → EXPIRED` (upload-window sweep). Idempotent; a lifecycle terminal
   * that emits no event. Returns true when this caller won.
   */
  async expireUpload(id: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE "verification_sessions"
       SET "state" = '${VerificationState.EXPIRED}', "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = '${VerificationState.PENDING_UPLOAD}'
       RETURNING "id"`,
      [id],
    );
    return rows.length > 0;
  }

  /**
   * Single-winner `PROCESSING → FAILED` after the stuck sweep exhausts its bounded re-enqueues.
   * A lifecycle terminal that emits no event. Returns true when this caller won.
   */
  async failFromProcessing(id: string, reason: FailureReason): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE "verification_sessions"
       SET "state" = '${VerificationState.FAILED}', "failure_reason" = $2,
           "processed_at" = NOW(), "updated_at" = NOW()
       WHERE "id" = $1 AND "state" = '${VerificationState.PROCESSING}'
       RETURNING "id"`,
      [id, reason],
    );
    return rows.length > 0;
  }

  /** Single-winner set of `video_deleted_at` after a retention hard-delete. Returns true when won. */
  async markVideoDeleted(id: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE "verification_sessions"
       SET "video_deleted_at" = NOW(), "updated_at" = NOW()
       WHERE "id" = $1 AND "video_deleted_at" IS NULL
       RETURNING "id"`,
      [id],
    );
    return rows.length > 0;
  }

  /** PENDING_UPLOAD rows older than `before` (upload-window sweep input). Oldest-first, bounded. */
  async findExpirableUploads(before: Date, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "verification_sessions"
       WHERE "state" = '${VerificationState.PENDING_UPLOAD}' AND "created_at" < $1
       ORDER BY "created_at" ASC
       LIMIT $2`,
      [before, limit],
    );
    return rows.map((row) => row.id);
  }

  /** UPLOADED/PROCESSING rows unchanged since `before` (stuck sweep input). Oldest-first, bounded. */
  async findStuckProcessing(before: Date, limit: number): Promise<VerificationRow[]> {
    return this.dataSource.query<VerificationRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "verification_sessions"
       WHERE "state" IN ('${VerificationState.UPLOADED}', '${VerificationState.PROCESSING}')
         AND "updated_at" < $1
       ORDER BY "updated_at" ASC
       LIMIT $2`,
      [before, limit],
    );
  }

  /** Rows whose video is past the retention horizon (retention scan). Oldest-first, bounded. */
  async findRetentionEligible(before: Date, limit: number): Promise<VerificationRow[]> {
    return this.dataSource.query<VerificationRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM "verification_sessions"
       WHERE "video_deleted_at" IS NULL AND "uploaded_at" IS NOT NULL AND "uploaded_at" < $1
       ORDER BY "uploaded_at" ASC
       LIMIT $2`,
      [before, limit],
    );
  }
}

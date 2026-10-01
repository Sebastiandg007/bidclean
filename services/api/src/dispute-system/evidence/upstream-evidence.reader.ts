import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * The structured, gated data a checklist reference resolves to (never bytes, never a URL).
 */
export interface ChecklistRefData {
  readonly runId: string | null;
  readonly state: string | null;
  readonly totalTasks: number | null;
  readonly completedTasks: number | null;
  readonly completedAt: string | null;
}

/** The structured data a verification reference resolves to (never the internal match score). */
export interface VerificationRefData {
  readonly verificationId: string | null;
  readonly state: string | null;
  readonly decision: string | null;
}

/** The structured data an arrival (service-tracking) reference resolves to. */
export interface ArrivalRefData {
  readonly sessionId: string | null;
  readonly state: string | null;
  readonly arrivedAt: string | null;
  readonly endedReason: string | null;
}

/**
 * UpstreamEvidenceReader (Spec 21) — read-only resolution of structured references.
 *
 * Resolves the checklist state + completion summary (Spec 19), the verification decision (Spec 18 —
 * the derived decision, NEVER the internal match score), and the arrival fact (Spec 17) for the
 * offer bound to a dispute. Returns gated structured data, never URLs, and NEVER mutates the upstream
 * record. Parameterized SQL only. All fields are nullable so a missing upstream fact resolves to
 * empty data rather than throwing.
 */
@Injectable()
export class UpstreamEvidenceReader {
  constructor(private readonly dataSource: DataSource) {}

  /** Resolve the checklist run summary for an offer (Spec 19). */
  async readChecklistRef(offerId: string): Promise<ChecklistRefData> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        state: string;
        total_tasks: number;
        completed_tasks: number;
        completed_at: Date | null;
      }>
    >(
      `SELECT "id", "state", "total_tasks", "completed_tasks", "completed_at"
       FROM "checklist_runs" WHERE "offer_id" = $1
       ORDER BY "created_at" DESC LIMIT 1`,
      [offerId],
    );
    const row = rows[0];
    if (!row) {
      return { runId: null, state: null, totalTasks: null, completedTasks: null, completedAt: null };
    }
    return {
      runId: row.id,
      state: row.state,
      totalTasks: row.total_tasks,
      completedTasks: row.completed_tasks,
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  /** Resolve the verification decision for an offer (Spec 18 — decision only, never the score). */
  async readVerificationRef(offerId: string): Promise<VerificationRefData> {
    const rows = await this.dataSource.query<
      Array<{ id: string; state: string; decision: string | null }>
    >(
      `SELECT "id", "state", "decision"
       FROM "verification_sessions" WHERE "offer_id" = $1
       ORDER BY "id" DESC LIMIT 1`,
      [offerId],
    );
    const row = rows[0];
    if (!row) {
      return { verificationId: null, state: null, decision: null };
    }
    return { verificationId: row.id, state: row.state, decision: row.decision };
  }

  /** Resolve the arrival fact for an offer (Spec 17). */
  async readArrivalRef(offerId: string): Promise<ArrivalRefData> {
    const rows = await this.dataSource.query<
      Array<{ id: string; state: string; arrived_at: Date | null; ended_reason: string | null }>
    >(
      `SELECT "id", "state", "arrived_at", "ended_reason"
       FROM "service_sessions" WHERE "offer_id" = $1 LIMIT 1`,
      [offerId],
    );
    const row = rows[0];
    if (!row) {
      return { sessionId: null, state: null, arrivedAt: null, endedReason: null };
    }
    return {
      sessionId: row.id,
      state: row.state,
      arrivedAt: row.arrived_at?.toISOString() ?? null,
      endedReason: row.ended_reason,
    };
  }
}

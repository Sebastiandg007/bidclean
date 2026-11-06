import { OutboxRow } from '../common/outbox/outbox-writer';
import {
  Decision,
  VERIFICATION_AGGREGATE_TYPE,
  VERIFICATION_OUTBOX_TABLE,
  VerificationOutboxEventType,
} from './video-verification.types';

/**
 * video-verification domain-owned outbox shaping for the durable result events
 * (`verification_completed` / `verification_flagged`).
 *
 * Emission is DECISION-BEARING ONLY (team-review decision): MATCH/NO_MATCH/INCONCLUSIVE emit
 * `verification_completed`; NO_MATCH/INCONCLUSIVE additionally emit `verification_flagged`;
 * FAILED/EXPIRED/DISABLED emit NOTHING. Each row is written in the SAME transaction as its
 * single-winner terminal transition. Payloads are minimal ids + derived fields — the raw
 * `match_score` is INTERNAL and never forwarded to the Host surface (`score` is included only so
 * downstream Spec 16 can dedup/version; it is never surfaced raw to the Host).
 */

/** Ids + derived fields shared by every verification result event. */
export interface VerificationOutboxParams {
  readonly verificationId: string;
  readonly serviceSessionId: string;
  readonly decision: Decision;
  readonly score: number | null;
}

/**
 * Build the outbox row(s) for a decision-bearing terminal. Returns `verification_completed` plus,
 * for a NO_MATCH/INCONCLUSIVE, an additional `verification_flagged`. Returns an empty array for a
 * decision that is not flag-worthy is impossible here (only decision-bearing terminals call this).
 */
export function buildResultOutboxRows(params: VerificationOutboxParams): OutboxRow[] {
  const rows: OutboxRow[] = [completedRow(params)];
  if (params.decision === Decision.NO_MATCH || params.decision === Decision.INCONCLUSIVE) {
    rows.push(flaggedRow(params));
  }
  return rows;
}

/** The `verification_completed` row (deterministic `verification_completed:<verificationId>`). */
function completedRow(params: VerificationOutboxParams): OutboxRow {
  return {
    eventId: `${VerificationOutboxEventType.COMPLETED}:${params.verificationId}`,
    aggregateType: VERIFICATION_AGGREGATE_TYPE,
    aggregateId: params.verificationId,
    type: VerificationOutboxEventType.COMPLETED,
    payload: {
      verificationId: params.verificationId,
      serviceSessionId: params.serviceSessionId,
      decision: params.decision,
      score: params.score,
    },
    tableName: VERIFICATION_OUTBOX_TABLE,
  };
}

/** The `verification_flagged` row (deterministic `verification_flagged:<verificationId>`). */
function flaggedRow(params: VerificationOutboxParams): OutboxRow {
  return {
    eventId: `${VerificationOutboxEventType.FLAGGED}:${params.verificationId}`,
    aggregateType: VERIFICATION_AGGREGATE_TYPE,
    aggregateId: params.verificationId,
    type: VerificationOutboxEventType.FLAGGED,
    payload: {
      verificationId: params.verificationId,
      serviceSessionId: params.serviceSessionId,
      decision: params.decision,
    },
    tableName: VERIFICATION_OUTBOX_TABLE,
  };
}

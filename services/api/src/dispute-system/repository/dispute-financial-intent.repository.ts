import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EscrowActionResult, IntentStatus } from '../dispute.types';

/** A raw financial-action intent row (snake_case as stored). */
export interface FinancialIntentRow {
  readonly id: string;
  readonly dispute_id: string | null;
  readonly payment_id: string;
  readonly action: string;
  readonly amount_cents: number | null;
  readonly status: string;
  readonly attempt: number;
}

/**
 * DisputeFinancialIntentRepository (`dispute_financial_intents`) — parameterized SQL only (Spec 21).
 *
 * Drives the durable money-effect COMMAND (release/refund). `drainClaimable`/`claimForDispatch`
 * mirror the escrow-intent repo (single-winner lease). On completion the worker records Spec 9's
 * distinct outcome: `markAccepted` (APPLIED/CEILING_CLAMPED/NO_OP, with `effective_amount_cents`) or
 * `markActionBlocked` (the durable needs-review terminal for a Spec 9 BLOCKED — money NOT moved).
 * Keys off `payment_id` + the intent row, so the effect completes even when `dispute_id` is NULL
 * after a cascade. Never calls Stripe.
 */
@Injectable()
export class DisputeFinancialIntentRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Claimable intents: PENDING/FAILED_RETRYABLE, or a DISPATCHED intent whose lease elapsed. */
  async drainClaimable(limit: number): Promise<FinancialIntentRow[]> {
    return this.dataSource.query<FinancialIntentRow[]>(
      `SELECT "id", "dispute_id", "payment_id", "action", "amount_cents", "status", "attempt"
       FROM "dispute_financial_intents"
       WHERE "status" IN ($1, $2)
          OR ("status" = $3 AND "lease_until" IS NOT NULL AND "lease_until" <= NOW())
       ORDER BY "created_at" ASC
       LIMIT $4`,
      [IntentStatus.PENDING, IntentStatus.FAILED_RETRYABLE, IntentStatus.DISPATCHED, limit],
    );
  }

  /** Single-winner lease claim: → DISPATCHED only when still claimable. Returns true for the winner. */
  async claimForDispatch(id: string, leaseMs: number): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE "dispute_financial_intents"
       SET "status" = $2,
           "dispatched_at" = NOW(),
           "lease_until" = NOW() + ($3 || ' milliseconds')::interval,
           "updated_at" = NOW()
       WHERE "id" = $1
         AND ("status" IN ($4, $5)
              OR ("status" = $2 AND "lease_until" IS NOT NULL AND "lease_until" <= NOW()))
       RETURNING "id"`,
      [id, IntentStatus.DISPATCHED, String(leaseMs), IntentStatus.PENDING, IntentStatus.FAILED_RETRYABLE],
    );
    return rows[0] !== undefined;
  }

  /**
   * Mark the intent ACCEPTED (Spec 9 durably APPLIED the effect), recording the surfaced outcome +
   * the authoritative `effective_amount_cents`. Idempotent per final state.
   */
  async markAccepted(
    id: string,
    outcome: EscrowActionResult,
    effectiveAmountCents: number | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_financial_intents"
       SET "status" = $2, "outcome" = $3, "effective_amount_cents" = $4,
           "last_error" = NULL, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" NOT IN ($2, $5)`,
      [id, IntentStatus.ACCEPTED, outcome, effectiveAmountCents, IntentStatus.ACTION_BLOCKED],
    );
  }

  /**
   * Mark the intent ACTION_BLOCKED (Spec 9 returned BLOCKED — money NOT moved) — the durable
   * needs-review terminal. Records the outcome + sanitized reason. The NONE escrow clear is NOT
   * enqueued for a blocked intent (clear-escrow-LAST), so `disputeStatus` stays OPEN.
   */
  async markActionBlocked(id: string, outcomeReason: string | null): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_financial_intents"
       SET "status" = $2, "outcome" = $3, "outcome_reason" = $4, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" NOT IN ($2, $5)`,
      [
        id,
        IntentStatus.ACTION_BLOCKED,
        EscrowActionResult.BLOCKED,
        outcomeReason === null ? null : outcomeReason.slice(0, 40),
        IntentStatus.ACCEPTED,
      ],
    );
  }

  /** Mark the intent FAILED_RETRYABLE on a transient failure (attempt++, clears the lease). */
  async markFailedRetryable(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_financial_intents"
       SET "status" = $2, "attempt" = "attempt" + 1, "lease_until" = NULL,
           "last_error" = $3, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" NOT IN ($4, $5)`,
      [id, IntentStatus.FAILED_RETRYABLE, sanitizeError(error), IntentStatus.ACCEPTED, IntentStatus.ACTION_BLOCKED],
    );
  }

  /** The financial intent for a dispute (partial-unique guarantees at most one). */
  async findByDispute(disputeId: string): Promise<FinancialIntentRow | null> {
    const rows = await this.dataSource.query<FinancialIntentRow[]>(
      `SELECT "id", "dispute_id", "payment_id", "action", "amount_cents", "status", "attempt"
       FROM "dispute_financial_intents" WHERE "dispute_id" = $1 LIMIT 1`,
      [disputeId],
    );
    return rows[0] ?? null;
  }
}

/** Strip anything that could leak a secret/PII from a transient-failure reason. */
function sanitizeError(error: string): string {
  return error.slice(0, 500);
}

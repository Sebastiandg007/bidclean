import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { EscrowIntentTarget, IntentStatus } from '../dispute.types';

/** A raw escrow-block intent row (snake_case as stored). */
export interface EscrowIntentRow {
  readonly id: string;
  readonly dispute_id: string | null;
  readonly payment_id: string;
  readonly target: string;
  readonly status: string;
  readonly attempt: number;
}

/**
 * DisputeEscrowIntentRepository (`dispute_escrow_intents`) — parameterized SQL only (Spec 21).
 *
 * Drives the durable escrow-block COMMAND (OPEN on creation, NONE on clear). `drainClaimable`
 * selects claimable intents (PENDING/FAILED_RETRYABLE, or a DISPATCHED intent whose lease elapsed);
 * `claimForDispatch` is the single-winner lease claim. Every method keys off `payment_id` + the
 * intent row, so the worker completes it even when `dispute_id` was nulled by a cascade. This repo
 * never calls Stripe — the worker that uses it calls Spec 9's `setDisputeStatus` via the EscrowClient.
 */
@Injectable()
export class DisputeEscrowIntentRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Enqueue an escrow-block intent (in the caller's opening/clearing transaction). */
  async enqueue(
    manager: EntityManager,
    disputeId: string,
    paymentId: string,
    target: EscrowIntentTarget,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "dispute_escrow_intents" ("dispute_id", "payment_id", "target", "status")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("dispute_id", "target") WHERE "dispute_id" IS NOT NULL DO NOTHING`,
      [disputeId, paymentId, target, IntentStatus.PENDING],
    );
  }

  /** Claimable intents: PENDING/FAILED_RETRYABLE, or a DISPATCHED intent whose lease elapsed. */
  async drainClaimable(limit: number): Promise<EscrowIntentRow[]> {
    return this.dataSource.query<EscrowIntentRow[]>(
      `SELECT "id", "dispute_id", "payment_id", "target", "status", "attempt"
       FROM "dispute_escrow_intents"
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
      `UPDATE "dispute_escrow_intents"
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

  /** Mark the intent ACCEPTED (Spec 9 accepted the block/clear). Idempotent per final state. */
  async markAccepted(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_escrow_intents"
       SET "status" = $2, "last_error" = NULL, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" <> $2`,
      [id, IntentStatus.ACCEPTED],
    );
  }

  /** Mark the intent FAILED_RETRYABLE on a transient failure (attempt++, clears the lease). */
  async markFailedRetryable(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "dispute_escrow_intents"
       SET "status" = $2, "attempt" = "attempt" + 1, "lease_until" = NULL,
           "last_error" = $3, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" <> $4`,
      [id, IntentStatus.FAILED_RETRYABLE, sanitizeError(error), IntentStatus.ACCEPTED],
    );
  }

  /** All escrow intents for a dispute (for the view / tests). */
  async findByDispute(disputeId: string): Promise<EscrowIntentRow[]> {
    return this.dataSource.query<EscrowIntentRow[]>(
      `SELECT "id", "dispute_id", "payment_id", "target", "status", "attempt"
       FROM "dispute_escrow_intents" WHERE "dispute_id" = $1 ORDER BY "created_at" ASC`,
      [disputeId],
    );
  }
}

/** Strip anything that could leak a secret/PII from a transient-failure reason. */
function sanitizeError(error: string): string {
  return error.slice(0, 500);
}

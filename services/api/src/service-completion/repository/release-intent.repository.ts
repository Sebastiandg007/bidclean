import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { IntentStatus } from '../completion.types';

/** A raw release-intent row (snake_case as stored). */
export interface ReleaseIntentRow {
  readonly id: string;
  readonly service_completion_id: string | null;
  readonly payment_id: string;
  readonly reason: string;
  readonly status: string;
  readonly attempt: number;
}

/**
 * ReleaseIntentRepository (`release_intents`) — parameterized SQL only (Spec 20).
 *
 * Drives the durable release COMMAND. `drainClaimable` selects intents eligible for a claim
 * (PENDING/FAILED_RETRYABLE, or a DISPATCHED intent whose lease elapsed), and `claimForDispatch` is
 * the single-winner lease claim (marking DISPATCHED is never an unconditional write). `markAccepted`
 * / `markFailedRetryable` are idempotent per final state. This repo never calls Stripe — the worker
 * that uses it calls Spec 9's `EscrowReleaseService.release`.
 */
@Injectable()
export class ReleaseIntentRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Intents eligible for a claim: PENDING/FAILED_RETRYABLE, or a DISPATCHED intent whose lease has
   * elapsed (an orphaned/crashed dispatch). Oldest-first, bounded (partial-index scan).
   */
  async drainClaimable(limit: number): Promise<ReleaseIntentRow[]> {
    return this.dataSource.query<ReleaseIntentRow[]>(
      `SELECT "id", "service_completion_id", "payment_id", "reason", "status", "attempt"
       FROM "release_intents"
       WHERE "status" IN ($1, $2)
          OR ("status" = $3 AND "lease_until" IS NOT NULL AND "lease_until" <= NOW())
       ORDER BY "created_at" ASC
       LIMIT $4`,
      [IntentStatus.PENDING, IntentStatus.FAILED_RETRYABLE, IntentStatus.DISPATCHED, limit],
    );
  }

  /**
   * The single-winner lease claim: `→ DISPATCHED` setting `dispatched_at`/`lease_until` only when
   * still claimable. Returns true for the winner (rows=1); a concurrent worker or a not-yet-expired
   * lease observes rows=0 and skips.
   */
  async claimForDispatch(id: string, leaseMs: number): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE "release_intents"
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

  /** Mark the intent ACCEPTED (Spec 9 accepted the release command). Idempotent per final state. */
  async markAccepted(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "release_intents"
       SET "status" = $2, "last_error" = NULL, "updated_at" = NOW()
       WHERE "id" = $1 AND "status" <> $2`,
      [id, IntentStatus.ACCEPTED],
    );
  }

  /** Mark the intent FAILED_RETRYABLE on a transient failure (attempt++, clears the lease). */
  async markFailedRetryable(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "release_intents"
       SET "status" = $2,
           "attempt" = "attempt" + 1,
           "lease_until" = NULL,
           "last_error" = $3,
           "updated_at" = NOW()
       WHERE "id" = $1 AND "status" <> $4`,
      [id, IntentStatus.FAILED_RETRYABLE, sanitizeError(error), IntentStatus.ACCEPTED],
    );
  }

  /** The intent for a completion (for the derived `release_status`). */
  async findByCompletion(completionId: string): Promise<ReleaseIntentRow | null> {
    const rows = await this.dataSource.query<ReleaseIntentRow[]>(
      `SELECT "id", "service_completion_id", "payment_id", "reason", "status", "attempt"
       FROM "release_intents"
       WHERE "service_completion_id" = $1
       LIMIT 1`,
      [completionId],
    );
    return rows[0] ?? null;
  }

  /** Insert an intent for a completion (used only by the transition helper / tests). */
  async insertForCompletion(
    manager: EntityManager,
    completionId: string,
    paymentId: string,
    reason: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "release_intents" ("service_completion_id", "payment_id", "reason", "status")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("service_completion_id") DO NOTHING`,
      [completionId, paymentId, reason, IntentStatus.PENDING],
    );
  }
}

/** Strip anything that could leak a secret/PII from a transient-failure reason. */
function sanitizeError(error: string): string {
  return error.slice(0, 500);
}

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISPUTE_INTENT_DRAIN_BATCH_SIZE,
  DISPUTE_INTENT_DRAIN_INTERVAL_MS,
  DISPUTE_INTENT_LEASE_MS,
} from '../dispute.constants';
import {
  APPLIED_ESCROW_RESULTS,
  EscrowActionOutcome,
  EscrowActionResult,
  FinancialIntentAction,
} from '../dispute.types';
import { EscrowClient } from '../escrow/escrow.client';
import {
  DisputeFinancialIntentRepository,
  FinancialIntentRow,
} from '../repository/dispute-financial-intent.repository';
import { DisputeRepository } from '../repository/dispute.repository';

/**
 * FinancialIntentWorker — drains durable money-effect intents into Spec 9 (Spec 21).
 *
 * Repeatable via `@Interval`. Drains claimable intents, CLAIMS each via the single-winner lease, maps
 * to `EscrowClient.release`/`refund` (idempotent), and interprets Spec 9's distinct outcome:
 *  - APPLIED / CEILING_CLAMPED / NO_OP → `markAccepted` (record outcome + effective amount), THEN
 *    enqueue the `NONE` escrow-block clear intent — the single point that begins clearing the escrow
 *    (clear-escrow-LAST).
 *  - BLOCKED (money NOT moved — e.g. PAYMENT_ALREADY_SETTLED) → `markActionBlocked` (durable
 *    needs-review terminal); do NOT enqueue the `NONE` clear (escrow stays OPEN); operator review.
 *  - transient failure → `FAILED_RETRYABLE` (attempt++); escrow stays OPEN.
 * KEYS OFF `payment_id` + the intent row, so the effect completes even when `dispute_id` is NULL
 * after a cascade. Holds no Stripe keys.
 */
@Injectable()
export class FinancialIntentWorker {
  private readonly logger = new Logger(FinancialIntentWorker.name);

  constructor(
    private readonly intents: DisputeFinancialIntentRepository,
    private readonly disputes: DisputeRepository,
    private readonly escrow: EscrowClient,
  ) {}

  /** The configured drain interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return DISPUTE_INTENT_DRAIN_INTERVAL_MS;
  }

  @Interval(FinancialIntentWorker.getIntervalMs())
  async drain(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.drainOnce();
  }

  /** One bounded, idempotent drain pass. */
  async drainOnce(): Promise<void> {
    try {
      const claimable = await this.intents.drainClaimable(DISPUTE_INTENT_DRAIN_BATCH_SIZE);
      for (const intent of claimable) {
        await this.processIntent(intent);
      }
    } catch (error) {
      this.logger.error(`Financial-intent drain failed: ${this.reason(error)}`);
    }
  }

  /** Claim (single-winner lease) then drive one intent into Spec 9's release/refund. */
  private async processIntent(intent: FinancialIntentRow): Promise<void> {
    const claimed = await this.intents.claimForDispatch(intent.id, DISPUTE_INTENT_LEASE_MS);
    if (!claimed) {
      return; // a concurrent worker or a not-yet-expired lease owns it
    }
    try {
      const outcome = await this.invoke(intent);
      await this.recordOutcome(intent, outcome);
    } catch (error) {
      await this.intents.markFailedRetryable(intent.id, this.reason(error));
    }
  }

  /** Map the intent action to the correct Spec 9 call. */
  private async invoke(intent: FinancialIntentRow): Promise<EscrowActionOutcome> {
    if (intent.action === FinancialIntentAction.RELEASE) {
      return this.escrow.release(intent.payment_id);
    }
    const amount = intent.action === FinancialIntentAction.PARTIAL_REFUND ? intent.amount_cents : null;
    return this.escrow.refund(intent.payment_id, amount);
  }

  /**
   * Record Spec 9's outcome. On an APPLIED terminal, enqueue the `NONE` clear (clear-escrow-LAST); on
   * BLOCKED, mark ACTION_BLOCKED and DO NOT clear (escrow stays OPEN, operator review).
   */
  private async recordOutcome(
    intent: FinancialIntentRow,
    outcome: EscrowActionOutcome,
  ): Promise<void> {
    if (APPLIED_ESCROW_RESULTS.includes(outcome.result)) {
      await this.intents.markAccepted(intent.id, outcome.result, outcome.effectiveAmountCents ?? null);
      await this.disputes.enqueueClearIntent(intent.dispute_id, intent.payment_id);
      return;
    }
    if (outcome.result === EscrowActionResult.BLOCKED) {
      await this.intents.markActionBlocked(intent.id, outcome.reason ?? null);
      this.logger.warn(`Dispute financial intent BLOCKED (needs review): ${outcome.reason ?? 'unknown'}`);
      return;
    }
    // Any unexpected result is treated as retryable rather than silently cleared.
    await this.intents.markFailedRetryable(intent.id, `unexpected outcome ${outcome.result}`);
  }

  /** Extract a safe error reason (never a secret/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

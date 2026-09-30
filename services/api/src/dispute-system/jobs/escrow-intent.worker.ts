import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISPUTE_INTENT_DRAIN_BATCH_SIZE,
  DISPUTE_INTENT_DRAIN_INTERVAL_MS,
  DISPUTE_INTENT_LEASE_MS,
} from '../dispute.constants';
import { EscrowIntentTarget } from '../dispute.types';
import { EscrowClient } from '../escrow/escrow.client';
import {
  DisputeEscrowIntentRepository,
  EscrowIntentRow,
} from '../repository/dispute-escrow-intent.repository';

/**
 * EscrowIntentWorker — drains durable escrow-block intents into Spec 9's `setDisputeStatus` (Spec 21).
 *
 * Repeatable via `@Interval`. Drains claimable intents (`PENDING`/`FAILED_RETRYABLE`, or a
 * `DISPATCHED` intent whose lease elapsed), CLAIMS each via the single-winner lease, then calls
 * `EscrowClient.setDisputeStatus(payment_id, target)` (`OPEN` on open, `NONE` on clear), marking
 * `ACCEPTED` on success or `FAILED_RETRYABLE` (attempt++) on transient failure. It KEYS OFF
 * `payment_id` + the intent row (never the dispute row), so a `PENDING` `NONE` intent still clears
 * the block on the correct payment even after `dispute_id` is nulled by a cascade. The ONLY path that
 * sets the escrow block; holds no Stripe keys. Lease-orphaned `DISPATCHED` is re-claimable.
 */
@Injectable()
export class EscrowIntentWorker {
  private readonly logger = new Logger(EscrowIntentWorker.name);

  constructor(
    private readonly intents: DisputeEscrowIntentRepository,
    private readonly escrow: EscrowClient,
  ) {}

  /** The configured drain interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return DISPUTE_INTENT_DRAIN_INTERVAL_MS;
  }

  @Interval(EscrowIntentWorker.getIntervalMs())
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
      this.logger.error(`Escrow-intent drain failed: ${this.reason(error)}`);
    }
  }

  /** Claim (single-winner lease) then drive one intent into Spec 9's setDisputeStatus. */
  private async processIntent(intent: EscrowIntentRow): Promise<void> {
    const claimed = await this.intents.claimForDispatch(intent.id, DISPUTE_INTENT_LEASE_MS);
    if (!claimed) {
      return; // a concurrent worker or a not-yet-expired lease owns it
    }
    try {
      const target = intent.target === EscrowIntentTarget.OPEN ? 'OPEN' : 'NONE';
      await this.escrow.setDisputeStatus(intent.payment_id, target);
      await this.intents.markAccepted(intent.id);
    } catch (error) {
      await this.intents.markFailedRetryable(intent.id, this.reason(error));
    }
  }

  /** Extract a safe error reason (never a secret/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

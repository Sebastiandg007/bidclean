import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { EscrowReleaseService } from '../../payments/escrow/escrow-release.service';
import { ReleaseReason } from '../../payments/payments.types';
import {
  SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE,
  SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS,
  SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS,
} from '../completion.constants';
import { CompletionReleaseReason } from '../completion.types';
import {
  ReleaseIntentRepository,
  ReleaseIntentRow,
} from '../repository/release-intent.repository';

/**
 * ReleaseIntentWorker — drains durable release intents into Spec 9's release (Spec 20).
 *
 * Repeatable via `@Interval`. Drains claimable intents (`PENDING`/`FAILED_RETRYABLE`, or a
 * `DISPATCHED` intent whose lease elapsed), CLAIMS each via the single-winner lease
 * `claimForDispatch`, then calls `EscrowReleaseService.release(payment_id, reason)` (idempotent;
 * Spec 9 single-winner), marking `ACCEPTED` on success or `FAILED_RETRYABLE` (attempt++) on
 * transient failure. `ACCEPTED` records that Spec 9 durably accepted the release COMMAND — NOT that
 * funds settled (a deferred payout is still ACCEPTED). This is the ONLY path that calls Spec 9; it
 * holds no Stripe keys. Recovery-safe by lease: an intent orphaned `DISPATCHED` by a crash is
 * re-claimable once its lease passes, re-driving `release(...)` (a Spec-9 no-op).
 */
@Injectable()
export class ReleaseIntentWorker {
  private readonly logger = new Logger(ReleaseIntentWorker.name);

  constructor(
    private readonly intents: ReleaseIntentRepository,
    private readonly escrowRelease: EscrowReleaseService,
  ) {}

  /** The configured drain interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS;
  }

  @Interval(ReleaseIntentWorker.getIntervalMs())
  async drain(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.drainOnce();
  }

  /** One bounded, idempotent drain pass. */
  async drainOnce(): Promise<void> {
    try {
      const claimable = await this.intents.drainClaimable(
        SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE,
      );
      for (const intent of claimable) {
        await this.processIntent(intent);
      }
    } catch (error) {
      this.logger.error(`Release-intent drain failed: ${this.reason(error)}`);
    }
  }

  /** Claim (single-winner lease) then drive one intent into Spec 9's release. */
  private async processIntent(intent: ReleaseIntentRow): Promise<void> {
    const claimed = await this.intents.claimForDispatch(
      intent.id,
      SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS,
    );
    if (!claimed) {
      return; // a concurrent worker or a not-yet-expired lease owns it
    }
    try {
      await this.escrowRelease.release(intent.payment_id, this.toReleaseReason(intent.reason));
      await this.intents.markAccepted(intent.id);
    } catch (error) {
      await this.intents.markFailedRetryable(intent.id, this.reason(error));
    }
  }

  /** Map the intent reason to Spec 9's ReleaseReason (only the two service-completion reasons). */
  private toReleaseReason(reason: string): ReleaseReason {
    return reason === CompletionReleaseReason.AUTO_RELEASE
      ? ReleaseReason.AUTO_RELEASE
      : ReleaseReason.HOST_CONFIRMED;
  }

  /** Extract a safe error reason (never a secret/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

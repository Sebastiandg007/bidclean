import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISPUTE_SLA_SWEEP_BATCH_SIZE,
  DISPUTE_SLA_SWEEP_INTERVAL_MS,
} from '../dispute.constants';
import { DisputeRepository } from '../repository/dispute.repository';
import { DisputeSlaService } from '../service/dispute-sla.service';

/**
 * DisputeSlaSweepProcessor — the never-stuck SLA sweep (Spec 21).
 *
 * Repeatable via `@Interval`. Selects due non-terminal disputes (partial index, bounded batch) whose
 * snapshotted `resolution_deadline` has passed, and calls `DisputeSlaService.expireDue(id)` per row
 * (single-winner, idempotent). A dispute resolved first is not selected (state changed). Bounded and
 * re-runnable; never throws.
 */
@Injectable()
export class DisputeSlaSweepProcessor {
  private readonly logger = new Logger(DisputeSlaSweepProcessor.name);

  constructor(
    private readonly disputes: DisputeRepository,
    private readonly sla: DisputeSlaService,
  ) {}

  /** The configured sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return DISPUTE_SLA_SWEEP_INTERVAL_MS;
  }

  @Interval(DisputeSlaSweepProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent pass over due non-terminal disputes. */
  async sweepOnce(): Promise<void> {
    try {
      const due = await this.disputes.findDueForSla(new Date(), DISPUTE_SLA_SWEEP_BATCH_SIZE);
      for (const disputeId of due) {
        await this.sla.expireDue(disputeId);
      }
      if (due.length > 0) {
        this.logger.debug(`SLA sweep expired ${due.length} dispute(s)`);
      }
    } catch (error) {
      this.logger.error(`SLA sweep failed: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason (never a secret/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

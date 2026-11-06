import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  SERVICE_COMPLETION_SWEEP_BATCH_SIZE,
  SERVICE_COMPLETION_SWEEP_INTERVAL_MS,
} from '../completion.constants';
import { AutoReleaseService } from '../service/auto-release.service';
import { CompletionRepository } from '../repository/completion.repository';

/**
 * AutoReleaseSweepProcessor — bounded, idempotent server-authoritative auto-release (Spec 20).
 *
 * Repeatable via `@Interval`. Selects `service_completions` where `state='AWAITING_CONFIRMATION' AND
 * auto_release_deadline <= NOW()` (bounded batch, partial index), and calls
 * `AutoReleaseService.autoReleaseDue(id)` per row (single-winner, idempotent). A disputed/confirmed
 * completion is not selected (state changed), so a `DISPUTED` completion is never auto-released. The
 * sweep never calls Stripe (the worker drives the intent). A per-row failure never stalls the batch.
 */
@Injectable()
export class AutoReleaseSweepProcessor {
  private readonly logger = new Logger(AutoReleaseSweepProcessor.name);

  constructor(
    private readonly repository: CompletionRepository,
    private readonly autoRelease: AutoReleaseService,
  ) {}

  /** The configured sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return SERVICE_COMPLETION_SWEEP_INTERVAL_MS;
  }

  @Interval(AutoReleaseSweepProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent sweep pass. */
  async sweepOnce(now: Date = new Date()): Promise<void> {
    try {
      const due = await this.repository.findDueForAutoRelease(now, SERVICE_COMPLETION_SWEEP_BATCH_SIZE);
      for (const id of due) {
        await this.autoReleaseOne(id);
      }
    } catch (error) {
      this.logger.error(`Auto-release sweep failed: ${this.reason(error)}`);
    }
  }

  /** Single-winner auto-release for one due completion; a per-row failure is isolated. */
  private async autoReleaseOne(id: string): Promise<void> {
    try {
      await this.autoRelease.autoReleaseDue(id);
    } catch (error) {
      this.logger.error(`Auto-release failed for ${id}: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason (never a secret/PII). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

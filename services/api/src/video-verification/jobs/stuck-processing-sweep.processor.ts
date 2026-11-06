import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';

import {
  VIDEO_VERIFICATION_COMPARISON_JOB_NAME,
  VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME,
  VIDEO_VERIFICATION_MAX_RETRIES,
  VIDEO_VERIFICATION_SWEEP_BATCH_SIZE,
  VIDEO_VERIFICATION_SWEEP_INTERVAL_MS,
  VIDEO_VERIFICATION_STUCK_THRESHOLD_MS,
} from '../video-verification.constants';
import { FailureReason, VerificationState } from '../video-verification.types';
import { VerificationRepository, VerificationRow } from '../repository/verification.repository';
import { ComparisonJobData } from '../service/verification.service';

/**
 * StuckProcessingSweep (repeatable via @Interval) — mirrors voice-notes' stuck-PENDING sweep.
 *
 * For rows stuck `UPLOADED` past the threshold it re-enqueues the comparison (the worker's own
 * atomic `beginProcessing` performs the `UPLOADED → PROCESSING` + attempt bump). For rows stuck
 * `PROCESSING` past the threshold it performs an explicit controlled `retryProcessing` (a single
 * conditional write that invalidates the previous attempt and creates the next), then re-enqueues.
 * Bounded by `VIDEO_VERIFICATION_MAX_RETRIES` → single-winner `FAILED` (`MAX_ATTEMPTS`) after max —
 * so a lost enqueue never leaves a verification stuck forever, and the counter is bumped only as
 * part of winning a controlled transition.
 */
@Injectable()
export class StuckProcessingSweep {
  private readonly logger = new Logger(StuckProcessingSweep.name);

  constructor(
    private readonly repository: VerificationRepository,
    @InjectQueue(VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME)
    private readonly comparisonQueue: Queue<ComparisonJobData>,
  ) {}

  /** The configured sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return VIDEO_VERIFICATION_SWEEP_INTERVAL_MS;
  }

  @Interval(StuckProcessingSweep.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded pass over UPLOADED/PROCESSING rows stuck past the threshold. */
  async sweepOnce(): Promise<void> {
    try {
      const before = new Date(Date.now() - VIDEO_VERIFICATION_STUCK_THRESHOLD_MS);
      const rows = await this.repository.findStuckProcessing(before, VIDEO_VERIFICATION_SWEEP_BATCH_SIZE);
      for (const row of rows) {
        await this.recover(row, before);
      }
      if (rows.length > 0) {
        this.logger.debug(`Stuck-processing sweep handled ${rows.length} verification(s)`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Stuck-processing sweep failed: ${reason}`);
    }
  }

  /** Recover one stuck row: re-enqueue (UPLOADED), retry (PROCESSING), or FAIL after max attempts. */
  private async recover(row: VerificationRow, stuckBefore: Date): Promise<void> {
    if (row.processing_attempt >= VIDEO_VERIFICATION_MAX_RETRIES) {
      await this.repository.failFromProcessing(row.id, FailureReason.MAX_ATTEMPTS);
      return;
    }
    if (row.state === VerificationState.UPLOADED) {
      await this.enqueue(row.id);
      return;
    }
    const retried = await this.repository.retryProcessing(row.id, stuckBefore);
    if (retried) {
      await this.enqueue(row.id);
    }
  }

  /** Re-enqueue a comparison job for a stuck verification; a failure is retried next tick. */
  private async enqueue(id: string): Promise<void> {
    try {
      await this.comparisonQueue.add(VIDEO_VERIFICATION_COMPARISON_JOB_NAME, { verificationId: id });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Re-enqueue of stuck verification ${id} failed; retry next sweep: ${reason}`);
    }
  }
}

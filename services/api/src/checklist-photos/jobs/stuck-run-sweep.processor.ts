import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  CHECKLIST_STUCK_RUN_THRESHOLD_MS,
  CHECKLIST_SWEEP_BATCH_SIZE,
  CHECKLIST_SWEEP_INTERVAL_MS,
} from '../checklist.constants';
import { AbandonReason } from '../checklist.types';
import { ChecklistRepository } from '../repository/checklist.repository';
import { ChecklistRunService } from '../service/checklist-run.service';

/**
 * StuckRunSweep — a defense-in-depth backstop (Spec 19).
 *
 * Repeatable via `@Interval`. For ACTIVE runs whose parent session is already terminal-for-tracking
 * past a threshold (a missed terminal signal), single-winner ACTIVE → ABANDONED so no run is stuck
 * forever. Bounded, idempotent; never throws.
 */
@Injectable()
export class StuckRunSweep {
  private readonly logger = new Logger(StuckRunSweep.name);

  constructor(
    private readonly repository: ChecklistRepository,
    private readonly runService: ChecklistRunService,
  ) {}

  /** The configured sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return CHECKLIST_SWEEP_INTERVAL_MS;
  }

  @Interval(StuckRunSweep.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent pass over stuck ACTIVE runs. */
  async sweepOnce(): Promise<void> {
    try {
      const before = new Date(Date.now() - CHECKLIST_STUCK_RUN_THRESHOLD_MS);
      const runIds = await this.repository.findStaleActiveRuns(before, CHECKLIST_SWEEP_BATCH_SIZE);
      for (const runId of runIds) {
        await this.runService.abandonRunById(runId, AbandonReason.SESSION_TERMINAL);
      }
      if (runIds.length > 0) {
        this.logger.debug(`Stuck-run sweep abandoned ${runIds.length} run(s)`);
      }
    } catch (error) {
      this.logger.error(`Stuck-run sweep failed: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason. */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

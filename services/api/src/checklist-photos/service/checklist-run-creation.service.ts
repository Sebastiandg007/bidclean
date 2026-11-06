import { Injectable, Logger } from '@nestjs/common';

import { ChecklistRepository } from '../repository/checklist.repository';
import { StartedPayload } from '../checklist.types';

/**
 * ChecklistRunCreationService — idempotent run creation off the durable `service_started` fact.
 *
 * `createFromStarted` copies the EVENT-CARRIED policy snapshots (`photo_required_policy`,
 * `completion_precondition`, `max_photos_per_task`) onto the run — never reads live config — so the
 * run's tasks and policies share one IN_PROGRESS temporal frontier. In ONE transaction it
 * `INSERT ... ON CONFLICT (service_session_id) DO NOTHING` the run then bulk-inserts the ordered
 * tasks from the event-carried snapshot. An empty snapshot creates a zero-task ACTIVE run (never
 * errors). `UNIQUE service_session_id` guarantees at most one run; a redelivered event is a no-op.
 */
@Injectable()
export class ChecklistRunCreationService {
  private readonly logger = new Logger(ChecklistRunCreationService.name);

  constructor(private readonly repository: ChecklistRepository) {}

  /**
   * Create the run + ordered tasks from the event-carried snapshot, idempotently. Returns true when
   * this call created the run. Never re-reads the live property or live config.
   */
  async createFromStarted(payload: StartedPayload): Promise<boolean> {
    const created = await this.repository.createRunWithTasks(payload);
    if (created) {
      this.logger.debug(
        `Created checklist run for session ${payload.sessionId} (${payload.checklistItems.length} task(s))`,
      );
    }
    return created;
  }
}

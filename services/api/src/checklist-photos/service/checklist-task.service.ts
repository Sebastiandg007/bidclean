import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { ChecklistParticipationService } from './checklist-participation.service';
import { ChecklistRepository, RunRow } from '../repository/checklist.repository';
import { CHECKLIST_ERROR_MESSAGES, ChecklistRunState } from '../checklist.types';

/**
 * ChecklistTaskService — the count-invariant task mutation (Spec 19).
 *
 * `markTask` asserts the caller is the Cleaner AND the run is ACTIVE + session in the allowed
 * IN_PROGRESS window (else 409; Host is read-only → 403). It mutates under the run `FOR UPDATE`
 * lock so that after every committed mutation — including concurrent mutations of DIFFERENT tasks
 * in the same run — `completed_tasks == COUNT(is_done=true)` with no lost updates. Idempotent per
 * final state (marking done twice yields one done task, not a corrupted counter).
 */
@Injectable()
export class ChecklistTaskService {
  constructor(
    private readonly repository: ChecklistRepository,
    private readonly participation: ChecklistParticipationService,
  ) {}

  /** Toggle a task done/undone under the run lock, keeping the count invariant. */
  async markTask(
    sessionId: string,
    userId: string,
    taskId: string,
    done: boolean,
  ): Promise<void> {
    await this.assertCleaner(sessionId, userId);
    await this.repository.withTransaction(async (manager) => {
      const run = await this.requireActiveRun(manager, sessionId);
      const task = await this.repository.findTaskById(taskId);
      if (!task || task.run_id !== run.id) {
        throw new NotFoundException(CHECKLIST_ERROR_MESSAGES.TASK_NOT_FOUND);
      }
      await this.repository.markTaskAtomic(manager, run.id, taskId, done);
    });
  }

  /** Assert the caller is the session's Cleaner (Host/non-participant rejected server-side). */
  private async assertCleaner(sessionId: string, userId: string): Promise<void> {
    const isParticipant = await this.participation.isParticipant(userId, sessionId);
    if (!isParticipant) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    const isCleaner = await this.participation.isCleaner(userId, sessionId);
    if (!isCleaner) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.NOT_THE_CLEANER);
    }
  }

  /** Lock + require an ACTIVE run whose session is still IN_PROGRESS (else 409/404). */
  private async requireActiveRun(manager: EntityManager, sessionId: string): Promise<RunRow> {
    const existing = await this.repository.findRunBySessionId(sessionId);
    if (!existing) {
      throw new NotFoundException(CHECKLIST_ERROR_MESSAGES.RUN_NOT_FOUND);
    }
    const run = await this.repository.lockRun(manager, existing.id);
    if (!run || run.state !== ChecklistRunState.ACTIVE) {
      throw new ConflictException(CHECKLIST_ERROR_MESSAGES.RUN_NOT_ACTIVE);
    }
    const inProgress = await this.participation.isInProgress(sessionId);
    if (!inProgress) {
      throw new ConflictException(CHECKLIST_ERROR_MESSAGES.RUN_NOT_ACTIVE);
    }
    return run;
  }
}

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { OutboxRow } from '../../common/outbox/outbox-writer';
import { ChecklistParticipationService } from './checklist-participation.service';
import { ChecklistRepository, RunRow, TaskRow } from '../repository/checklist.repository';
import {
  AbandonReason,
  CHECKLIST_AGGREGATE_TYPE,
  CHECKLIST_COMPLETED_EVENT_TYPE,
  CHECKLIST_ERROR_MESSAGES,
  CHECKLIST_OUTBOX_TABLE,
  ChecklistRunState,
  ChecklistRunView,
  ChecklistTaskView,
  CompletionPrecondition,
  PhotoRequiredPolicy,
  TaskPhotoKind,
  isTaskPhotoKind,
} from '../checklist.types';

/**
 * ChecklistRunService — the run state machine (Spec 19).
 *
 * `finalize` (Cleaner) takes the run `FOR UPDATE` lock (the same lock finalize-photo takes, so the
 * two serialize), evaluates the run's SNAPSHOTTED completion precondition against the durable rows
 * (never live config), computes the summary under the lock, then single-winner ACTIVE → COMPLETED +
 * `checklist_completed` into `checklist_outbox` in the SAME transaction — so a concurrent photo
 * finalize is either counted in `photoCount` (committed first) or rejected after (never omitted). An
 * unmet precondition rejects with a clear reason and leaves the run ACTIVE.
 * `forceAbandonForSession` is an idempotent single-winner ACTIVE → ABANDONED (offer/session
 * terminal). checklist-photos never releases escrow, resolves disputes, or rates.
 */
@Injectable()
export class ChecklistRunService {
  constructor(
    private readonly repository: ChecklistRepository,
    private readonly participation: ChecklistParticipationService,
  ) {}

  /** Cleaner finalizes the checklist: precondition-gated, run-locked, single-winner + outbox. */
  async finalize(sessionId: string, userId: string): Promise<void> {
    await this.assertCleaner(sessionId, userId);
    await this.repository.withTransaction(async (manager) => {
      const run = await this.requireActiveLockedRun(manager, sessionId);
      const tasks = await this.repository.findTasks(run.id);
      const photoCount = await this.repository.countPhotosForRun(manager, run.id);
      await this.assertPreconditionMet(manager, run, tasks);
      const completedTasks = tasks.filter((task) => task.is_done).length;
      // Stamp one authoritative finish time and carry the SAME value on `checklist_completed`
      // (Spec 20 anchors its auto-release deadline to this, never a consume time).
      const completedAt = new Date();
      const outbox = this.buildCompletedOutbox(run, tasks.length, completedTasks, photoCount, completedAt);
      const won = await this.repository.transitionRun(
        manager,
        run.id,
        ChecklistRunState.COMPLETED,
        { completedAt: true, completedAtValue: completedAt },
        outbox,
      );
      if (!won) {
        throw new ConflictException(CHECKLIST_ERROR_MESSAGES.RUN_NOT_ACTIVE);
      }
    });
  }

  /** Idempotent single-winner ACTIVE → ABANDONED for the session (offer/session-terminal path). */
  async forceAbandonForSession(sessionId: string, reason: AbandonReason): Promise<void> {
    const run = await this.repository.findRunBySessionId(sessionId);
    if (!run || run.state !== ChecklistRunState.ACTIVE) {
      return;
    }
    await this.repository.withTransaction(async (manager) => {
      const locked = await this.repository.lockRun(manager, run.id);
      if (!locked || locked.state !== ChecklistRunState.ACTIVE) {
        return;
      }
      await this.repository.transitionRun(
        manager,
        run.id,
        ChecklistRunState.ABANDONED,
        { abandonedReason: reason },
        null,
      );
    });
  }

  /** Idempotent single-winner ABANDONED for the offer's run (offer-terminal listener path). */
  async forceAbandonForOffer(offerId: string, reason: AbandonReason): Promise<void> {
    const run = await this.repository.findRunByOfferId(offerId);
    if (!run || run.state !== ChecklistRunState.ACTIVE) {
      return;
    }
    await this.abandonRunById(run.id, reason);
  }

  /** Idempotent single-winner ABANDONED for a run id (stuck-run sweep). */
  async abandonRunById(runId: string, reason: AbandonReason): Promise<void> {
    await this.repository.withTransaction(async (manager) => {
      const locked = await this.repository.lockRun(manager, runId);
      if (!locked || locked.state !== ChecklistRunState.ACTIVE) {
        return;
      }
      await this.repository.transitionRun(
        manager,
        runId,
        ChecklistRunState.ABANDONED,
        { abandonedReason: reason },
        null,
      );
    });
  }

  /** Participant-gated reconciliation read (run + ordered tasks + photo refs; never keys/bytes). */
  async getChecklist(sessionId: string, userId: string): Promise<ChecklistRunView> {
    const isParticipant = await this.participation.isParticipant(userId, sessionId);
    if (!isParticipant) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    const run = await this.repository.findRunBySessionId(sessionId);
    if (!run) {
      throw new NotFoundException(CHECKLIST_ERROR_MESSAGES.RUN_NOT_FOUND);
    }
    const tasks = await this.repository.findTasks(run.id);
    const photos = await this.repository.findPhotosForRun(run.id);
    return this.toView(run, tasks, photos);
  }

  // ─── Guards / helpers ──────────────────────────────────────────────────────

  /** Assert the caller is the session's Cleaner. */
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
  private async requireActiveLockedRun(manager: EntityManager, sessionId: string): Promise<RunRow> {
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

  /**
   * Evaluate the run's SNAPSHOTTED completion precondition against the durable rows. Throws with a
   * clear reason when unmet (run stays ACTIVE). Never reads live config.
   */
  private async assertPreconditionMet(
    manager: EntityManager,
    run: RunRow,
    tasks: readonly TaskRow[],
  ): Promise<void> {
    const precondition = this.parsePrecondition(run.completion_precondition_snapshot);
    if (precondition === 'NONE') {
      return;
    }
    if (precondition === 'ALL_TASKS_DONE' && tasks.some((task) => !task.is_done)) {
      throw new ConflictException(CHECKLIST_ERROR_MESSAGES.PRECONDITION_UNMET);
    }
    if (precondition === 'ALL_REQUIRED_PHOTOS') {
      await this.assertRequiredPhotos(manager, run, tasks);
    }
  }

  /**
   * ALL_REQUIRED_PHOTOS: every task required by the snapshotted photo-required policy must have at
   * least one committed photo. With policy ALL_TASKS, every task requires a photo.
   */
  private async assertRequiredPhotos(
    manager: EntityManager,
    run: RunRow,
    tasks: readonly TaskRow[],
  ): Promise<void> {
    const policy = this.parsePolicy(run.photo_required_policy_snapshot);
    if (policy === 'NONE') {
      return;
    }
    for (const task of tasks) {
      const count = await this.repository.countPhotosForTask(manager, task.id);
      if (count === 0) {
        throw new ConflictException(CHECKLIST_ERROR_MESSAGES.PRECONDITION_UNMET);
      }
    }
  }

  /** Build the deterministic `checklist_completed` outbox row for this transition. */
  private buildCompletedOutbox(
    run: RunRow,
    totalTasks: number,
    completedTasks: number,
    photoCount: number,
    completedAt: Date,
  ): OutboxRow {
    return {
      eventId: `${CHECKLIST_COMPLETED_EVENT_TYPE}:${run.id}`,
      aggregateType: CHECKLIST_AGGREGATE_TYPE,
      aggregateId: run.id,
      type: CHECKLIST_COMPLETED_EVENT_TYPE,
      payload: {
        runId: run.id,
        serviceSessionId: run.service_session_id,
        totalTasks,
        completedTasks,
        photoCount,
        // The authoritative finish time carried on the event (Spec 20 additive extension).
        completedAt: completedAt.toISOString(),
      },
      tableName: CHECKLIST_OUTBOX_TABLE,
    };
  }

  /** Project raw rows to the client view (photo refs only — never keys/URLs). */
  private toView(
    run: RunRow,
    tasks: readonly TaskRow[],
    photos: ReadonlyArray<{ id: string; task_id: string; kind: string; uploaded_at: Date; object_deleted_at: Date | null }>,
  ): ChecklistRunView {
    const taskViews: ChecklistTaskView[] = tasks.map((task) => ({
      id: task.id,
      position: task.position,
      taskText: task.task_text,
      isDone: task.is_done,
      completedAt: task.completed_at ? task.completed_at.toISOString() : null,
      photos: photos
        .filter((photo) => photo.task_id === task.id && photo.object_deleted_at === null)
        .map((photo) => ({
          id: photo.id,
          kind: this.parseKind(photo.kind),
          uploadedAt: photo.uploaded_at.toISOString(),
        })),
    }));
    return {
      id: run.id,
      serviceSessionId: run.service_session_id,
      state: run.state as ChecklistRunState,
      totalTasks: run.total_tasks,
      completedTasks: run.completed_tasks,
      maxPhotosPerTask: run.max_photos_per_task_snapshot,
      tasks: taskViews,
    };
  }

  /** Parse a snapshotted JSONB precondition into the typed union (defaults to NONE). */
  private parsePrecondition(value: unknown): CompletionPrecondition {
    if (value === 'ALL_TASKS_DONE' || value === 'ALL_REQUIRED_PHOTOS') {
      return value;
    }
    return 'NONE';
  }

  /** Parse a snapshotted JSONB photo-required policy into the typed union (defaults to NONE). */
  private parsePolicy(value: unknown): PhotoRequiredPolicy {
    return value === 'ALL_TASKS' ? 'ALL_TASKS' : 'NONE';
  }

  /** Parse a stored kind string into the typed union (defaults to GENERAL). */
  private parseKind(value: string): TaskPhotoKind {
    return isTaskPhotoKind(value) ? value : TaskPhotoKind.GENERAL;
  }
}

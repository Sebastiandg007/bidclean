import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { CHECKLIST_PHOTO_ALLOWED_MIME_TYPES, CHECKLIST_PHOTO_MAX_SIZE_BYTES } from '../checklist.constants';
import { ChecklistParticipationService } from './checklist-participation.service';
import { ChecklistRepository, RunRow, TaskRow } from '../repository/checklist.repository';
import { ChecklistStorageService } from '../storage/checklist-storage.service';
import { ChecklistUploadGrantRepository } from '../repository/checklist-upload-grant.repository';
import {
  CHECKLIST_ERROR_MESSAGES,
  ChecklistRunState,
  GrantStatus,
  PlaybackTarget,
  TaskPhotoKind,
  UploadTarget,
  isTaskPhotoKind,
} from '../checklist.types';

/** Advisory client metadata for a finalize (server re-inspects; declared values never override). */
export interface FinalizePhotoInput {
  readonly objectKey: string;
  readonly kind?: string;
}

/**
 * ChecklistPhotoService — evidence upload/finalize/playback (voice-notes model, run-locked).
 *
 * `requestUpload` reserves a per-task slot atomically under the run lock (`committed_photos +
 * active ISSUED grants < max`), persists the grant FIRST, then mints a pre-signed PUT — so two
 * concurrent requests cannot both pass the cap. `finalizeUpload` takes the SAME run lock finalize-
 * checklist takes (so the two serialize), re-checks grant + lifecycle + cap, server-inspects the
 * object (authoritative), inserts the photo, and consumes the grant. `getPlaybackUrl` is
 * session-scoped: the key is resolved from the DB by photo id, never a client-supplied value.
 */
@Injectable()
export class ChecklistPhotoService {
  constructor(
    private readonly repository: ChecklistRepository,
    private readonly grants: ChecklistUploadGrantRepository,
    private readonly storage: ChecklistStorageService,
    private readonly participation: ChecklistParticipationService,
  ) {}

  /** Cleaner-gated atomic per-task slot reservation → grant persisted first → pre-signed PUT. */
  async requestUpload(sessionId: string, userId: string, taskId: string): Promise<UploadTarget> {
    await this.assertCleaner(sessionId, userId);
    const objectKey = this.storage.generateObjectKey();
    await this.repository.withTransaction(async (manager) => {
      const run = await this.requireActiveLockedRun(manager, sessionId);
      const task = await this.requireTask(taskId, run.id);
      await this.assertSlotAvailable(manager, run, task.id);
      await this.grants.createGrant(manager, {
        objectKey,
        runId: run.id,
        taskId: task.id,
        issuedToUserId: userId,
      });
    });
    return this.storage.presignUploadTarget(objectKey);
  }

  /** Run-locked finalize: re-verify grant + lifecycle + cap, server-inspect, insert, consume. */
  async finalizeUpload(
    sessionId: string,
    userId: string,
    taskId: string,
    input: FinalizePhotoInput,
  ): Promise<void> {
    await this.assertCleaner(sessionId, userId);
    // Inspect the object up front (I/O outside the lock), but re-check lifecycle FIRST under the
    // lock so a finalize after the run is terminal is rejected (409) regardless of object validity.
    const inspection = await this.storage.inspectObject(input.objectKey);
    const kind = this.resolveKind(input.kind);

    await this.repository.withTransaction(async (manager) => {
      const run = await this.requireActiveLockedRun(manager, sessionId);
      const task = await this.requireTask(taskId, run.id);
      await this.requireValidGrant(manager, input.objectKey, userId, run.id, task.id);
      this.assertObjectAcceptable(inspection);
      await this.assertCapForFinalize(manager, run, task.id);
      const photoId = await this.repository.insertPhoto(manager, {
        taskId: task.id,
        runId: run.id,
        objectKey: input.objectKey,
        kind,
        sizeBytes: inspection.sizeBytes,
        mimeType: inspection.contentType,
        width: inspection.width,
        height: inspection.height,
      });
      await this.grants.markConsumed(manager, input.objectKey, photoId);
    });
  }

  /** Session-scoped, participant-gated playback: key resolved from DB (never client-supplied). */
  async getPlaybackUrl(
    sessionId: string,
    userId: string,
    photoId: string,
  ): Promise<PlaybackTarget> {
    const photo = await this.repository.findPhotoScopedToSession(photoId, sessionId);
    if (!photo) {
      throw new NotFoundException(CHECKLIST_ERROR_MESSAGES.PHOTO_NOT_FOUND);
    }
    const isParticipant = await this.participation.isParticipant(userId, sessionId);
    if (!isParticipant) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    if (photo.objectDeletedAt !== null) {
      throw new NotFoundException(CHECKLIST_ERROR_MESSAGES.OBJECT_MISSING);
    }
    return this.storage.getPlaybackTarget(photo.objectKey);
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

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

  /** Require the task belongs to the run. */
  private async requireTask(taskId: string, runId: string): Promise<TaskRow> {
    const task = await this.repository.findTaskById(taskId);
    if (!task || task.run_id !== runId) {
      throw new NotFoundException(CHECKLIST_ERROR_MESSAGES.TASK_NOT_FOUND);
    }
    return task;
  }

  /** Atomic slot reservation: committed photos + active ISSUED grants < max (under the run lock). */
  private async assertSlotAvailable(
    manager: EntityManager,
    run: RunRow,
    taskId: string,
  ): Promise<void> {
    const committed = await this.repository.countPhotosForTask(manager, taskId);
    const active = await this.grants.countActiveGrantsForTask(manager, taskId, new Date());
    if (committed + active >= run.max_photos_per_task_snapshot) {
      throw new ConflictException(CHECKLIST_ERROR_MESSAGES.PHOTO_CAP_REACHED);
    }
  }

  /** Re-validate the cap at finalize under the run lock (over-cap → 400, nothing persisted). */
  private async assertCapForFinalize(
    manager: EntityManager,
    run: RunRow,
    taskId: string,
  ): Promise<void> {
    const committed = await this.repository.countPhotosForTask(manager, taskId);
    if (committed >= run.max_photos_per_task_snapshot) {
      throw new BadRequestException(CHECKLIST_ERROR_MESSAGES.PHOTO_CAP_REACHED);
    }
  }

  /** Re-verify the grant (exists, issued to caller, matching run/task, unexpired, ISSUED). */
  private async requireValidGrant(
    manager: EntityManager,
    objectKey: string,
    userId: string,
    runId: string,
    taskId: string,
  ): Promise<void> {
    const grant = await this.grants.findConsumable(manager, objectKey);
    if (!grant || grant.runId !== runId || grant.taskId !== taskId) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.GRANT_NOT_FOUND);
    }
    if (grant.issuedToUserId !== userId) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.GRANT_NOT_FOUND);
    }
    if (grant.status !== GrantStatus.ISSUED || grant.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException(CHECKLIST_ERROR_MESSAGES.GRANT_UNUSABLE);
    }
  }

  /** Server-authoritative object validation (client metadata advisory). */
  private assertObjectAcceptable(inspection: {
    exists: boolean;
    sizeBytes: number;
    contentType: string;
    width: number | null;
    height: number | null;
  }): void {
    if (!inspection.exists) {
      throw new BadRequestException(CHECKLIST_ERROR_MESSAGES.OBJECT_MISSING);
    }
    if (inspection.sizeBytes > CHECKLIST_PHOTO_MAX_SIZE_BYTES) {
      throw new BadRequestException(CHECKLIST_ERROR_MESSAGES.OBJECT_TOO_LARGE);
    }
    if (!CHECKLIST_PHOTO_ALLOWED_MIME_TYPES.includes(inspection.contentType)) {
      throw new BadRequestException(CHECKLIST_ERROR_MESSAGES.OBJECT_INVALID_TYPE);
    }
    if (inspection.width === null || inspection.height === null) {
      throw new BadRequestException(CHECKLIST_ERROR_MESSAGES.OBJECT_UNPROBEABLE);
    }
  }

  /** Resolve the (advisory) kind to a valid enum, defaulting to GENERAL. */
  private resolveKind(kind: string | undefined): TaskPhotoKind {
    if (kind !== undefined && isTaskPhotoKind(kind)) {
      return kind;
    }
    return TaskPhotoKind.GENERAL;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  CHECKLIST_CLEANUP_BATCH_SIZE,
  CHECKLIST_CLEANUP_INTERVAL_MS,
  CHECKLIST_PHOTO_RETENTION_DAYS,
} from '../checklist.constants';
import { ChecklistRepository } from '../repository/checklist.repository';
import { ChecklistStorageService } from '../storage/checklist-storage.service';

/** Milliseconds per day for the retention horizon. */
const MS_PER_DAY = 86_400_000;

/**
 * RetentionCleanupProcessor — hard-deletes evidence photos past the retention horizon (Spec 19).
 *
 * Repeatable via `@Interval`; interval/batch from config. Selects `checklist_task_photos` whose
 * `uploaded_at` is older than `CHECKLIST_PHOTO_RETENTION_DAYS` and whose object is not yet deleted,
 * calls `deleteObjectSafe` (idempotent), and sets `object_deleted_at` once. The metadata row +
 * completion summary persist as audit. The retention clock is `uploaded_at`. Never throws.
 */
@Injectable()
export class RetentionCleanupProcessor {
  private readonly logger = new Logger(RetentionCleanupProcessor.name);

  constructor(
    private readonly repository: ChecklistRepository,
    private readonly storage: ChecklistStorageService,
  ) {}

  /** The configured cleanup interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return CHECKLIST_CLEANUP_INTERVAL_MS;
  }

  @Interval(RetentionCleanupProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent pass over retention-eligible photos. */
  async sweepOnce(): Promise<void> {
    try {
      const before = new Date(Date.now() - CHECKLIST_PHOTO_RETENTION_DAYS * MS_PER_DAY);
      const eligible = await this.repository.findRetentionEligible(before, CHECKLIST_CLEANUP_BATCH_SIZE);
      for (const photo of eligible) {
        await this.storage.deleteObjectSafe(photo.objectKey);
        await this.repository.markObjectDeleted(photo.id);
      }
      if (eligible.length > 0) {
        this.logger.debug(`Retention swept ${eligible.length} photo object(s)`);
      }
    } catch (error) {
      this.logger.error(`Retention cleanup failed: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason (never an object key or bytes). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE,
  VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS,
  VIDEO_VERIFICATION_RETENTION_HOURS,
} from '../video-verification.constants';
import { VerificationRepository, VerificationRow } from '../repository/verification.repository';
import { VerificationStorageService } from '../storage/verification-storage.service';

/** Milliseconds per hour for the retention-horizon computation. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * RetentionCleanupProcessor (repeatable via @Interval) — mirrors the KYC cleanup job.
 *
 * Selects rows whose video is past the retention horizon
 * (`video_deleted_at IS NULL AND uploaded_at IS NOT NULL AND (now - uploaded_at) > RETENTION_HOURS`;
 * the clock is `uploaded_at`, never `created_at`/`processed_at`), hard-deletes the object
 * idempotently, and single-winner sets `video_deleted_at`. The derived result/score persists and the
 * record is retained (no `deleted_at`). Bounded and idempotent; per-item errors are logged and
 * retried next tick. Never logs video bytes.
 */
@Injectable()
export class RetentionCleanupProcessor {
  private readonly logger = new Logger(RetentionCleanupProcessor.name);

  constructor(
    private readonly repository: VerificationRepository,
    private readonly storage: VerificationStorageService,
  ) {}

  /** The configured cleanup interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS;
  }

  @Interval(RetentionCleanupProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded retention pass: hard-delete objects past the horizon, mark video_deleted_at. */
  async sweepOnce(): Promise<void> {
    try {
      const before = new Date(Date.now() - VIDEO_VERIFICATION_RETENTION_HOURS * MS_PER_HOUR);
      const rows = await this.repository.findRetentionEligible(
        before,
        VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE,
      );
      for (const row of rows) {
        await this.deleteVideo(row);
      }
      if (rows.length > 0) {
        this.logger.debug(`Retention cleanup deleted ${rows.length} video(s)`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Retention cleanup failed: ${reason}`);
    }
  }

  /** Hard-delete one video (idempotent) then single-winner mark video_deleted_at. */
  private async deleteVideo(row: VerificationRow): Promise<void> {
    if (!row.object_key) {
      return;
    }
    await this.storage.deleteObjectSafe(row.object_key);
    await this.repository.markVideoDeleted(row.id);
  }
}

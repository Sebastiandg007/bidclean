import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE,
  VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS,
} from '../video-verification.constants';
import { ObjectDeletionRepository } from '../repository/object-deletion.repository';
import { VerificationStorageService } from '../storage/verification-storage.service';

/**
 * TombstoneDrainProcessor (repeatable via @Interval).
 *
 * Drains `video_verification_object_deletions` where `status = 'PENDING'` (oldest-first, batched):
 * `deleteObjectSafe` then mark DONE. This is how a video whose only owning row cascaded away is
 * still deleted — the `BEFORE DELETE` trigger tombstoned its `object_key` in the deleting
 * transaction. Idempotent; per-item errors are logged and retried next tick. Never logs video bytes.
 */
@Injectable()
export class TombstoneDrainProcessor {
  private readonly logger = new Logger(TombstoneDrainProcessor.name);

  constructor(
    private readonly objectDeletionRepository: ObjectDeletionRepository,
    private readonly storage: VerificationStorageService,
  ) {}

  /** The configured cleanup interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS;
  }

  @Interval(TombstoneDrainProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded pass: delete each tombstoned object idempotently, mark DONE. */
  async sweepOnce(): Promise<void> {
    try {
      const pending = await this.objectDeletionRepository.findPending(
        VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE,
      );
      for (const tombstone of pending) {
        await this.storage.deleteObjectSafe(tombstone.objectKey);
        await this.objectDeletionRepository.markDone(tombstone.objectKey);
      }
      if (pending.length > 0) {
        this.logger.debug(`Tombstone drain removed ${pending.length} object(s)`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Tombstone drain failed: ${reason}`);
    }
  }
}

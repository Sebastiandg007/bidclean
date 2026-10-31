import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { CHECKLIST_CLEANUP_BATCH_SIZE, CHECKLIST_CLEANUP_INTERVAL_MS } from '../checklist.constants';
import { ChecklistObjectDeletionRepository } from '../repository/checklist-object-deletion.repository';
import { ChecklistStorageService } from '../storage/checklist-storage.service';

/**
 * TombstoneDrainProcessor — drains freed object-key tombstones (Spec 19).
 *
 * Repeatable via `@Interval`. Drains `checklist_photo_object_deletions` where `status='PENDING'`
 * (oldest first, batched): `deleteObjectSafe(object_key)` → mark `DONE`. This is how a photo whose
 * only owning row cascaded away is still deleted. Idempotent; never throws.
 */
@Injectable()
export class TombstoneDrainProcessor {
  private readonly logger = new Logger(TombstoneDrainProcessor.name);

  constructor(
    private readonly deletions: ChecklistObjectDeletionRepository,
    private readonly storage: ChecklistStorageService,
  ) {}

  /** The configured cleanup interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return CHECKLIST_CLEANUP_INTERVAL_MS;
  }

  @Interval(TombstoneDrainProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent drain pass. */
  async sweepOnce(): Promise<void> {
    try {
      const pending = await this.deletions.drainPending(CHECKLIST_CLEANUP_BATCH_SIZE);
      for (const tombstone of pending) {
        await this.storage.deleteObjectSafe(tombstone.objectKey);
        await this.deletions.markDone(tombstone.objectKey);
      }
      if (pending.length > 0) {
        this.logger.debug(`Tombstone drain removed ${pending.length} object(s)`);
      }
    } catch (error) {
      this.logger.error(`Tombstone drain failed: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason (never an object key or bytes). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

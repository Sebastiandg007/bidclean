import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  CHECKLIST_STALE_GRANT_BATCH_SIZE,
  CHECKLIST_STALE_GRANT_INTERVAL_MS,
} from '../checklist.constants';
import { ChecklistStorageService } from '../storage/checklist-storage.service';
import { ChecklistUploadGrantRepository } from '../repository/checklist-upload-grant.repository';
import { GrantStatus } from '../checklist.types';

/**
 * StaleUploadGrantCleanupProcessor — closes the uploaded-but-never-finalized orphan path (Spec 19).
 *
 * Repeatable via `@Interval`; interval/batch from config. It reaches the one orphan neither
 * retention (no photo row) nor the tombstone trigger (no cascade) can: an object PUT to MinIO whose
 * finalize never succeeded, leaving an unconsumed `ISSUED` grant and possibly an orphan object. It
 * selects expired/stale `ISSUED` grants, calls `deleteObjectSafe` (idempotent — the object may or
 * may not exist), and marks the grant `EXPIRED` (`markClosed`) so it is no longer eternally
 * `ISSUED`. Bounded and idempotent; never throws.
 */
@Injectable()
export class StaleUploadGrantCleanupProcessor {
  private readonly logger = new Logger(StaleUploadGrantCleanupProcessor.name);

  constructor(
    private readonly grants: ChecklistUploadGrantRepository,
    private readonly storage: ChecklistStorageService,
  ) {}

  /** The configured stale-grant sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return CHECKLIST_STALE_GRANT_INTERVAL_MS;
  }

  @Interval(StaleUploadGrantCleanupProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent pass over stale ISSUED grants. */
  async sweepOnce(): Promise<void> {
    try {
      const stale = await this.grants.findStaleGrants(new Date(), CHECKLIST_STALE_GRANT_BATCH_SIZE);
      for (const grant of stale) {
        await this.storage.deleteObjectSafe(grant.objectKey);
        await this.grants.markClosed(grant.objectKey, GrantStatus.EXPIRED);
      }
      if (stale.length > 0) {
        this.logger.debug(`Stale-grant cleanup swept ${stale.length} grant(s)`);
      }
    } catch (error) {
      this.logger.error(`Stale-grant cleanup failed: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason (never an object key or bytes). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISPUTE_STALE_GRANT_BATCH_SIZE,
  DISPUTE_STALE_GRANT_INTERVAL_MS,
} from '../dispute.constants';
import { GrantStatus } from '../dispute.types';
import { DisputeUploadGrantRepository } from '../repository/dispute-upload-grant.repository';
import { DisputeEvidenceStorageService } from '../storage/dispute-evidence-storage.service';

/**
 * StaleGrantCleanupProcessor — closes the uploaded-but-never-finalized orphan path (Spec 21).
 *
 * Repeatable via `@Interval`. It reaches the one orphan neither retention (no evidence row) nor the
 * tombstone trigger (no cascade) can: an object PUT to MinIO whose finalize never succeeded, leaving
 * an unconsumed `ISSUED` grant and possibly an orphan object. It selects expired/stale `ISSUED`
 * grants, calls `deleteObjectSafe` (idempotent), and marks the grant `EXPIRED` (`markClosed`) so it
 * is no longer eternally `ISSUED`. Bounded and idempotent; never throws.
 */
@Injectable()
export class StaleGrantCleanupProcessor {
  private readonly logger = new Logger(StaleGrantCleanupProcessor.name);

  constructor(
    private readonly grants: DisputeUploadGrantRepository,
    private readonly storage: DisputeEvidenceStorageService,
  ) {}

  /** The configured stale-grant sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return DISPUTE_STALE_GRANT_INTERVAL_MS;
  }

  @Interval(StaleGrantCleanupProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent pass over stale ISSUED grants. */
  async sweepOnce(): Promise<void> {
    try {
      const stale = await this.grants.findStaleGrants(new Date(), DISPUTE_STALE_GRANT_BATCH_SIZE);
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

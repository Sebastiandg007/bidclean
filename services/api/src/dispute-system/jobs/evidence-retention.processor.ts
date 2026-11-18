import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISPUTE_CLEANUP_BATCH_SIZE,
  DISPUTE_CLEANUP_INTERVAL_MS,
  DISPUTE_EVIDENCE_RETENTION_DAYS,
  MS_PER_DAY,
} from '../dispute.constants';
import { DisputeEvidenceRepository } from '../repository/dispute-evidence.repository';
import { DisputeEvidenceStorageService } from '../storage/dispute-evidence-storage.service';

/**
 * EvidenceRetentionProcessor — hard-deletes evidence objects past the retention horizon (Spec 21).
 *
 * Repeatable via `@Interval`. It hard-deletes HOST_PHOTO objects ONLY for disputes that are already
 * TERMINAL (`RESOLVED`/`EXPIRED`) AND whose `uploaded_at` is older than
 * `DISPUTE_EVIDENCE_RETENTION_DAYS` (the repository query enforces both). Evidence for a non-terminal
 * dispute is NEVER deleted, so evidence still needed for an in-flight resolution is never destroyed.
 * Sets `object_deleted_at` (metadata retained as audit). Bounded, idempotent; never throws.
 */
@Injectable()
export class EvidenceRetentionProcessor {
  private readonly logger = new Logger(EvidenceRetentionProcessor.name);

  constructor(
    private readonly evidence: DisputeEvidenceRepository,
    private readonly storage: DisputeEvidenceStorageService,
  ) {}

  /** The configured retention sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return DISPUTE_CLEANUP_INTERVAL_MS;
  }

  @Interval(EvidenceRetentionProcessor.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded, idempotent retention pass (TERMINAL-dispute objects past the horizon only). */
  async sweepOnce(): Promise<void> {
    try {
      const before = new Date(Date.now() - DISPUTE_EVIDENCE_RETENTION_DAYS * MS_PER_DAY);
      const deletable = await this.evidence.findRetentionDeletable(before, DISPUTE_CLEANUP_BATCH_SIZE);
      for (const row of deletable) {
        await this.storage.deleteObjectSafe(row.objectKey);
        await this.evidence.markObjectDeleted(row.evidenceId);
      }
      if (deletable.length > 0) {
        this.logger.debug(`Evidence retention removed ${deletable.length} object(s)`);
      }
    } catch (error) {
      this.logger.error(`Evidence retention failed: ${this.reason(error)}`);
    }
  }

  /** Extract a safe error reason (never an object key or bytes). */
  private reason(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown';
  }
}

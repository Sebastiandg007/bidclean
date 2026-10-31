import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  VIDEO_VERIFICATION_SWEEP_BATCH_SIZE,
  VIDEO_VERIFICATION_SWEEP_INTERVAL_MS,
  VIDEO_VERIFICATION_UPLOAD_WINDOW_MS,
} from '../video-verification.constants';
import { VerificationRepository } from '../repository/verification.repository';

/**
 * UploadWindowSweep (repeatable via @Interval).
 *
 * Single-winner `PENDING_UPLOAD → EXPIRED` for verifications older than
 * `VIDEO_VERIFICATION_UPLOAD_WINDOW_MS` with no upload, so a never-uploaded verification is never
 * stuck awaiting an upload. EXPIRED is a lifecycle terminal — it emits no event. Bounded and
 * idempotent; per-item errors are logged and retried next tick.
 */
@Injectable()
export class UploadWindowSweep {
  private readonly logger = new Logger(UploadWindowSweep.name);

  constructor(private readonly repository: VerificationRepository) {}

  /** The configured sweep interval (ms), exposed for the @Interval decorator. */
  static getIntervalMs(): number {
    return VIDEO_VERIFICATION_SWEEP_INTERVAL_MS;
  }

  @Interval(UploadWindowSweep.getIntervalMs())
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    await this.sweepOnce();
  }

  /** One bounded pass: expire never-uploaded verifications past the window. */
  async sweepOnce(): Promise<void> {
    try {
      const before = new Date(Date.now() - VIDEO_VERIFICATION_UPLOAD_WINDOW_MS);
      const ids = await this.repository.findExpirableUploads(before, VIDEO_VERIFICATION_SWEEP_BATCH_SIZE);
      for (const id of ids) {
        await this.repository.expireUpload(id);
      }
      if (ids.length > 0) {
        this.logger.debug(`Upload-window sweep expired ${ids.length} verification(s)`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Upload-window sweep failed: ${reason}`);
    }
  }
}

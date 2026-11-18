import { Injectable, Logger } from '@nestjs/common';

import {
  VIDEO_VERIFICATION_ENABLED,
  VIDEO_VERIFICATION_MATCH_THRESHOLD,
} from '../video-verification.constants';
import { ArrivalPayload, VerificationState } from '../video-verification.types';
import { VerificationRepository } from '../repository/verification.repository';

/**
 * VerificationCreationService — idempotent creation off the durable `service_arrived` fact.
 *
 * Reacts to the arrival fact by inserting exactly one `verification_sessions` row per service
 * session (`INSERT ... ON CONFLICT (service_session_id) DO NOTHING`), snapshotting the config
 * `match_threshold` at creation so a later config change never retroactively re-decides it. When
 * verification is ENABLED the row is `PENDING_UPLOAD`; when DISABLED it is `DISABLED` with NO grant,
 * NO video, NO job — privacy-by-design (biometric-adjacent data is never captured when it cannot be
 * used). It never enqueues anything on creation (there is no video yet). Never throws into the
 * consumer batch; a creation failure never touches the already-committed arrival.
 */
@Injectable()
export class VerificationCreationService {
  private readonly logger = new Logger(VerificationCreationService.name);

  constructor(private readonly repository: VerificationRepository) {}

  /**
   * Create the verification for an arrival, idempotently. Enabled ⇒ PENDING_UPLOAD; disabled ⇒
   * DISABLED. Requires a resolvable Cleaner (participant) on the payload; a null cleaner means the
   * arrival cannot seed a Cleaner-scoped verification and is skipped (logged, not thrown).
   */
  async createFromArrival(payload: ArrivalPayload): Promise<void> {
    if (!payload.cleanerId) {
      this.logger.warn(`Arrival ${payload.sessionId} has no cleaner; verification not created`);
      return;
    }
    const state = VIDEO_VERIFICATION_ENABLED
      ? VerificationState.PENDING_UPLOAD
      : VerificationState.DISABLED;
    await this.repository.createFromArrival({
      serviceSessionId: payload.sessionId,
      offerId: payload.offerId,
      cleanerId: payload.cleanerId,
      hostId: payload.hostId,
      state,
      matchThreshold: VIDEO_VERIFICATION_MATCH_THRESHOLD,
    });
  }
}

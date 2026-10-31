import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';

import {
  VIDEO_VERIFICATION_ALLOWED_MIME_TYPES,
  VIDEO_VERIFICATION_COMPARISON_JOB_NAME,
  VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME,
  VIDEO_VERIFICATION_MAX_DURATION_MS,
  VIDEO_VERIFICATION_MAX_SIZE_BYTES,
} from '../video-verification.constants';
import {
  classify,
  GrantStatus,
  InspectResult,
  UploadTarget,
  VERIFICATION_ERROR_MESSAGES,
  VerificationState,
  VerificationView,
} from '../video-verification.types';
import { ConsumableGrant, UploadGrantRepository } from '../repository/upload-grant.repository';
import { VerificationRepository, VerificationRow } from '../repository/verification.repository';
import { VerificationParticipationService } from './verification-participation.service';
import { VerificationStorageService } from '../storage/verification-storage.service';
import { FinalizeUploadDto } from '../dto/finalize-upload.dto';

/** The comparison job payload enqueued after a durable finalize (and by the stuck sweep). */
export interface ComparisonJobData {
  readonly verificationId: string;
}

/**
 * VerificationService — the state-machine orchestrator for the upload flow.
 *
 * Resolves authorization from the session's parties (never client identity or an object key).
 * `requestUpload` asserts the Cleaner + PENDING_UPLOAD, PERSISTS THE GRANT FIRST, then mints the
 * pre-signed PUT (key ≠ credential). `finalizeUpload` verifies the grant inside a transaction,
 * server-inspects the object (authoritative size/type/real-duration), single-winner
 * `PENDING_UPLOAD → UPLOADED`, consumes the grant, and best-effort enqueues the comparison after
 * commit. `getVerification` returns the authoritative state + derived classification only — never
 * `match_score`, never a video URL. Functions are small and single-responsibility.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: VerificationRepository,
    private readonly grantRepository: UploadGrantRepository,
    private readonly participation: VerificationParticipationService,
    private readonly storage: VerificationStorageService,
    @InjectQueue(VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME)
    private readonly comparisonQueue: Queue<ComparisonJobData>,
  ) {}

  /** Participant-gated reconciliation read: authoritative state + derived classification only. */
  async getVerification(id: string, userId: string): Promise<VerificationView> {
    const participation = await this.participation.resolve(userId, id);
    if (!participation) {
      throw new NotFoundException(VERIFICATION_ERROR_MESSAGES.NOT_FOUND);
    }
    if (!participation.isParticipant) {
      throw new ForbiddenException(VERIFICATION_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    return this.toView(participation.row);
  }

  /**
   * Cleaner + PENDING_UPLOAD gated. Persists the grant FIRST, then mints the pre-signed PUT, and
   * returns `{ objectKey, uploadUrl, expiresAt }`. A non-Cleaner participant or non-participant is
   * denied; a DISABLED/terminal state yields a lifecycle conflict (409-equivalent BadRequest).
   */
  async requestUpload(id: string, userId: string): Promise<UploadTarget> {
    const participation = await this.participation.resolve(userId, id);
    if (!participation || !participation.isParticipant) {
      throw new ForbiddenException(VERIFICATION_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    if (!participation.isCleaner) {
      throw new ForbiddenException(VERIFICATION_ERROR_MESSAGES.NOT_THE_CLEANER);
    }
    if (participation.row.state !== VerificationState.PENDING_UPLOAD) {
      throw new BadRequestException(VERIFICATION_ERROR_MESSAGES.NOT_PENDING_UPLOAD);
    }
    const objectKey = this.storage.generateObjectKey();
    await this.grantRepository.createGrant({
      objectKey,
      serviceSessionId: participation.row.service_session_id,
      issuedToUserId: userId,
    });
    return this.storage.presignUploadTarget(objectKey);
  }

  /**
   * Cleaner + grant-gated finalize. Transaction: verify grant, server-inspect object (authoritative),
   * single-winner `PENDING_UPLOAD → UPLOADED`, consume grant. After commit, best-effort enqueue the
   * comparison. Invalid grant → 403/BadRequest; over-limit/wrong-type/unprobeable → 400.
   */
  async finalizeUpload(id: string, userId: string, dto: FinalizeUploadDto): Promise<VerificationView> {
    const participation = await this.participation.resolve(userId, id);
    if (!participation || !participation.isParticipant) {
      throw new ForbiddenException(VERIFICATION_ERROR_MESSAGES.NOT_A_PARTICIPANT);
    }
    if (!participation.isCleaner) {
      throw new ForbiddenException(VERIFICATION_ERROR_MESSAGES.NOT_THE_CLEANER);
    }
    const inspect = await this.storage.inspectObject(dto.objectKey);
    this.assertObjectAcceptable(inspect);
    await this.commitFinalize(id, userId, participation.row.service_session_id, dto.objectKey);
    await this.enqueueComparison(id);
    const updated = await this.repository.findById(id);
    return this.toView(updated ?? participation.row);
  }

  /** The finalize transaction: verify grant, single-winner transition, consume grant. */
  private async commitFinalize(
    id: string,
    userId: string,
    serviceSessionId: string,
    objectKey: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const grant = await this.grantRepository.findConsumable(manager, objectKey);
      this.assertGrantUsable(grant, userId, serviceSessionId);
      const won = await this.repository.markUploaded(manager, id, objectKey);
      if (!won) {
        // Lost the single-winner transition (already advanced/terminal): idempotent no-op.
        return;
      }
      await this.grantRepository.markConsumed(manager, objectKey, id);
    });
  }

  /** Best-effort enqueue of the comparison; a failure never fails finalize (sweep recovers). */
  private async enqueueComparison(id: string): Promise<void> {
    try {
      await this.comparisonQueue.add(VIDEO_VERIFICATION_COMPARISON_JOB_NAME, { verificationId: id });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Comparison enqueue failed for ${id}; stuck sweep will recover: ${reason}`);
    }
  }

  /** Server-authoritative object bounds: size ≤ max, allowed video type, probeable duration ≤ max. */
  private assertObjectAcceptable(inspect: InspectResult): void {
    if (!inspect.exists) {
      throw new BadRequestException(VERIFICATION_ERROR_MESSAGES.OBJECT_MISSING);
    }
    if (inspect.sizeBytes > VIDEO_VERIFICATION_MAX_SIZE_BYTES) {
      throw new BadRequestException(VERIFICATION_ERROR_MESSAGES.OBJECT_TOO_LARGE);
    }
    if (!VIDEO_VERIFICATION_ALLOWED_MIME_TYPES.includes(inspect.contentType)) {
      throw new BadRequestException(VERIFICATION_ERROR_MESSAGES.OBJECT_INVALID_TYPE);
    }
    if (inspect.durationMs === null || inspect.durationMs > VIDEO_VERIFICATION_MAX_DURATION_MS) {
      throw new BadRequestException(VERIFICATION_ERROR_MESSAGES.DURATION_TOO_LONG);
    }
  }

  /** Grant must exist, be ISSUED, unexpired, issued to this caller, and match the session. */
  private assertGrantUsable(
    grant: ConsumableGrant | null,
    userId: string,
    serviceSessionId: string,
  ): void {
    if (!grant || grant.issuedToUserId !== userId || grant.serviceSessionId !== serviceSessionId) {
      throw new ForbiddenException(VERIFICATION_ERROR_MESSAGES.GRANT_NOT_FOUND);
    }
    if (grant.status !== GrantStatus.ISSUED || grant.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(VERIFICATION_ERROR_MESSAGES.GRANT_UNUSABLE);
    }
  }

  /** Map a row to the client view — never `match_score`, never a video URL (REQ-VV15 / P13). */
  private toView(row: VerificationRow): VerificationView {
    const state = row.state as VerificationState;
    return {
      id: row.id,
      serviceSessionId: row.service_session_id,
      state,
      classification: classify(state),
      createdAt: row.created_at.toISOString(),
      uploadedAt: row.uploaded_at ? row.uploaded_at.toISOString() : null,
      processedAt: row.processed_at ? row.processed_at.toISOString() : null,
    };
  }
}

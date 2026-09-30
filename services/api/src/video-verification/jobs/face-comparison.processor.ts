import { Processor, WorkerHost } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import { Job } from 'bullmq';

import { VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME } from '../video-verification.constants';
import { buildResultOutboxRows } from '../verification-outbox';
import {
  Decision,
  FailureReason,
  VerificationState,
} from '../video-verification.types';
import { VerificationRepository, VerificationRow } from '../repository/verification.repository';
import { VerificationStorageService } from '../storage/verification-storage.service';
import { KycReferenceReader } from '../storage/kyc-reference-reader';
import { FaceVerifyClient } from '../ai-client/face-verify.client';
import { FaceVerifyClientError } from '../ai-client/face-verify.types';
import { ComparisonJobData } from '../service/verification.service';

/**
 * FaceComparisonProcessor (BullMQ `video-face-comparison` queue).
 *
 * Asynchronous, best-effort, stale-update-safe, Option A. Each run performs the ATOMIC
 * `beginProcessing` (fuses `UPLOADED → PROCESSING` with the attempt increment); a loser gets `null`
 * and no-ops WITHOUT bumping the counter. The winner reads the video from MinIO (deleted → FAILED
 * `VIDEO_UNAVAILABLE`, no loop), reads the Cleaner's VERIFIED KYC selfie (null → INCONCLUSIVE,
 * non-fatal), posts the BYTES to the AI `/verify-face` (Option A; failure/timeout → FAILED), decides
 * `MATCH`/`NO_MATCH` against the ROW's SNAPSHOT threshold (never live config), and writes the result
 * guarded by the latest attempt — emitting `verification_completed` (+ `verification_flagged` on
 * NO_MATCH/INCONCLUSIVE) in the same transaction. It never blocks the service, seizes escrow, or
 * changes KYC. Video/reference bytes and the score are never logged.
 */
@Processor(VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME)
export class FaceComparisonProcessor extends WorkerHost {
  constructor(
    private readonly repository: VerificationRepository,
    private readonly storage: VerificationStorageService,
    private readonly kycReader: KycReferenceReader,
    private readonly faceVerify: FaceVerifyClient,
  ) {
    super();
  }

  /** Process one comparison job. Errors propagate so BullMQ applies bounded retry/backoff. */
  async process(job: Job<ComparisonJobData>): Promise<void> {
    const { verificationId } = job.data;
    const begun = await this.repository.beginProcessing(verificationId);
    if (begun === null) {
      // Lost the atomic transition (not UPLOADED, or a concurrent winner) — no side effects, no bump.
      return;
    }
    const row = await this.repository.findById(verificationId);
    if (!row) {
      return;
    }
    await this.runComparison(row, begun.attempt);
  }

  /** Read video + reference, compare, and write the guarded result (all non-fatal on failure). */
  private async runComparison(row: VerificationRow, attempt: number): Promise<void> {
    const video = row.object_key ? await this.storage.readObject(row.object_key) : null;
    if (video === null) {
      await this.fail(row.id, attempt, FailureReason.VIDEO_UNAVAILABLE);
      return;
    }
    const reference = row.cleaner_id
      ? await this.kycReader.getVerifiedSelfie(row.cleaner_id)
      : null;
    if (reference === null) {
      await this.inconclusive(row, attempt);
      return;
    }
    await this.compareAndWrite(row, attempt, video, reference);
  }

  /** Call the AI service and write the MATCH/NO_MATCH result; AI failure → FAILED (bounded). */
  private async compareAndWrite(
    row: VerificationRow,
    attempt: number,
    video: Buffer,
    reference: Buffer,
  ): Promise<void> {
    let score: number;
    try {
      const result = await this.faceVerify.compare(video, reference, randomUUID());
      // A no-face / inconclusive result from the model is a non-fatal advisory outcome.
      if (result.decision === Decision.INCONCLUSIVE) {
        await this.inconclusive(row, attempt);
        return;
      }
      score = result.score;
    } catch (error) {
      await this.fail(row.id, attempt, this.classifyAiFailure(error));
      return;
    }
    const decision = this.decideAgainstSnapshot(score, row.match_threshold);
    await this.repository.writeResultGuarded(
      row.id,
      attempt,
      decision === Decision.MATCH ? VerificationState.MATCH : VerificationState.NO_MATCH,
      { decision, matchScore: score },
      buildResultOutboxRows({
        verificationId: row.id,
        serviceSessionId: row.service_session_id,
        decision,
        score,
      }),
    );
  }

  /** Decide MATCH iff `score >= snapshot threshold` (the ROW's value, never live config). */
  private decideAgainstSnapshot(score: number, matchThreshold: string): Decision {
    return score >= parseFloat(matchThreshold) ? Decision.MATCH : Decision.NO_MATCH;
  }

  /** Write an INCONCLUSIVE terminal (guarded) with its decision-bearing outbox events. */
  private async inconclusive(row: VerificationRow, attempt: number): Promise<void> {
    await this.repository.writeResultGuarded(
      row.id,
      attempt,
      VerificationState.INCONCLUSIVE,
      { decision: Decision.INCONCLUSIVE },
      buildResultOutboxRows({
        verificationId: row.id,
        serviceSessionId: row.service_session_id,
        decision: Decision.INCONCLUSIVE,
        score: null,
      }),
    );
  }

  /** Write a FAILED terminal (guarded); a lifecycle terminal that emits no event. */
  private async fail(id: string, attempt: number, reason: FailureReason): Promise<void> {
    await this.repository.writeResultGuarded(
      id,
      attempt,
      VerificationState.FAILED,
      { failureReason: reason },
      [],
    );
  }

  /** Map an AI client error to a non-sensitive failure reason. */
  private classifyAiFailure(error: unknown): FailureReason {
    if (error instanceof FaceVerifyClientError && error.name === 'FaceVerifyTimeoutError') {
      return FailureReason.AI_TIMEOUT;
    }
    return FailureReason.AI_UNAVAILABLE;
  }
}

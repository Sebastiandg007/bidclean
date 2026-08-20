import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import axios from 'axios';
import { KycVerification } from '../entities/kyc-verification.entity';
import { User } from '../../auth/entities/user.entity';
import { KycStatus } from '../kyc.types';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycAuditService } from '../kyc-audit.service';
import { AiClientService } from '../ai-client/ai-client.service';
import { AiClientError } from '../ai-client/ai-client.errors';
import { OcrResult, FaceCompareResult, LivenessResult } from '../ai-client/ai-client.types';

/** Payload structure for the KYC processing job */
interface KycJobPayload {
  readonly verificationId: string;
}

/** Thresholds loaded from environment configuration */
interface ProcessingThresholds {
  readonly ocrConfidence: number;
  readonly faceSimilarity: number;
  readonly liveness: number;
}

/** Constants for audit log actions */
const AUDIT_METADATA_TRIGGER = 'kyc-processing-job';

/** Default OneSignal API URL — overridable via ONESIGNAL_API_URL env var */
const DEFAULT_ONESIGNAL_API_URL = 'https://onesignal.com/api/v1/notifications';

/** Push notification i18n keys */
const NOTIFICATION_HEADING_KEY = 'kyc.notification.heading';
const NOTIFICATION_VERIFIED_KEY = 'kyc.notification.verified';
const NOTIFICATION_REJECTED_KEY = 'kyc.notification.rejected';

/** Default notification content (fallback when i18n unavailable in backend push) */
const NOTIFICATION_CONTENT = {
  [NOTIFICATION_HEADING_KEY]: 'KYC Verification Update',
  [NOTIFICATION_VERIFIED_KEY]: 'Your identity has been verified successfully!',
  [NOTIFICATION_REJECTED_KEY]: 'Your identity verification was not successful. Please try again.',
} as const;

/** Admin escalation reason */
const ADMIN_REVIEW_REASON = 'Processing failed after maximum retries. Escalated to admin review.';

/**
 * KYC processing job.
 * Handles async verification pipeline: OCR → liveness → face comparison → scoring.
 * Enqueued by KycService after selfie upload.
 * Uses BullMQ with configurable retries and exponential backoff.
 *
 * Pipeline short-circuits on deterministic failures (4xx from AI service).
 * Transient failures (5xx, network, timeout) cause the job to throw,
 * allowing BullMQ to retry with exponential backoff.
 * After max retries exhausted, transitions to REJECTED with admin review reason.
 */
@Processor('kyc-processing')
export class KycProcessJob extends WorkerHost {
  private readonly logger = new Logger(KycProcessJob.name);
  readonly maxRetries: number;
  readonly backoffMs: number;
  private readonly thresholds: ProcessingThresholds;
  private readonly oneSignalAppId: string | null;
  private readonly oneSignalApiKey: string | null;
  private readonly oneSignalApiUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(KycVerification)
    private readonly kycRepository: Repository<KycVerification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stateTransitionService: KycStateTransitionService,
    private readonly kycAuditService: KycAuditService,
    private readonly aiClientService: AiClientService,
  ) {
    super();
    this.maxRetries = parseInt(
      this.configService.getOrThrow<string>('KYC_PROCESSING_MAX_RETRIES'),
      10,
    );
    this.backoffMs = parseInt(
      this.configService.getOrThrow<string>('KYC_PROCESSING_BACKOFF_MS'),
      10,
    );
    this.thresholds = {
      ocrConfidence: parseFloat(
        this.configService.getOrThrow<string>('KYC_OCR_CONFIDENCE_THRESHOLD'),
      ),
      faceSimilarity: parseFloat(
        this.configService.getOrThrow<string>('KYC_FACE_SIMILARITY_THRESHOLD'),
      ),
      liveness: parseFloat(
        this.configService.getOrThrow<string>('KYC_LIVENESS_THRESHOLD'),
      ),
    };
    this.oneSignalAppId = this.configService.get<string>('ONESIGNAL_APP_ID') ?? null;
    this.oneSignalApiKey = this.configService.get<string>('ONESIGNAL_API_KEY') ?? null;
    this.oneSignalApiUrl = this.configService.get<string>('ONESIGNAL_API_URL') ?? DEFAULT_ONESIGNAL_API_URL;
  }

  /**
   * BullMQ process handler — entry point for each job execution.
   */
  async process(job: Job<KycJobPayload>): Promise<void> {
    const { verificationId } = job.data;
    this.logger.log(`Processing KYC verification ${verificationId} (attempt ${job.attemptsMade + 1})`);

    const verification = await this.loadVerification(verificationId);
    await this.incrementProcessingAttempts(verification);

    try {
      await this.transitionToProcessing(verification);
      const ocrResult = await this.runOcr(verification);
      const livenessResult = await this.runLiveness(verification);
      const faceResult = await this.runFaceCompare(verification);
      const nameMatchScore = await this.calculateNameMatch(verification, ocrResult);

      await this.persistScores(verification, ocrResult, livenessResult, faceResult, nameMatchScore);
      await this.evaluateAndTransition(verification, ocrResult, livenessResult, faceResult, nameMatchScore);
    } catch (error) {
      await this.handleProcessingError(error, verification, job);
    }
  }

  /** Load verification entity from database */
  private async loadVerification(verificationId: string): Promise<KycVerification> {
    return this.kycRepository.findOneOrFail({ where: { id: verificationId } });
  }

  /** Increment processing attempts counter on the entity */
  private async incrementProcessingAttempts(verification: KycVerification): Promise<void> {
    await this.kycRepository.update(verification.id, {
      processingAttempts: verification.processingAttempts + 1,
    });
  }

  /** Transition verification to PROCESSING state */
  private async transitionToProcessing(verification: KycVerification): Promise<void> {
    const result = await this.stateTransitionService.transition({
      targetStatus: KycStatus.PROCESSING,
      context: { verification },
    });

    if (!result.wasIdempotent) {
      await this.createAuditLog(
        verification.id,
        null,
        result.previousStatus,
        KycStatus.PROCESSING,
      );
    }
  }

  /** Run OCR extraction — short-circuits on deterministic failure */
  private async runOcr(verification: KycVerification): Promise<OcrResult> {
    try {
      return await this.aiClientService.extractDocument({
        imageKey: verification.documentStorageKey!,
        correlationId: verification.id,
      });
    } catch (error) {
      if (this.isDeterministicFailure(error)) {
        await this.rejectWithReason(
          verification,
          `OCR failed: ${(error as AiClientError).message}`,
        );
      }
      throw error;
    }
  }

  /** Run liveness detection — short-circuits on deterministic failure */
  private async runLiveness(verification: KycVerification): Promise<LivenessResult> {
    try {
      return await this.aiClientService.detectLiveness({
        selfieImageKey: verification.selfieStorageKey!,
        correlationId: verification.id,
      });
    } catch (error) {
      if (this.isDeterministicFailure(error)) {
        await this.rejectWithReason(
          verification,
          `Liveness check failed: ${(error as AiClientError).message}`,
        );
      }
      throw error;
    }
  }

  /** Run face comparison — short-circuits on deterministic failure */
  private async runFaceCompare(verification: KycVerification): Promise<FaceCompareResult> {
    try {
      return await this.aiClientService.compareFaces({
        documentImageKey: verification.documentStorageKey!,
        selfieImageKey: verification.selfieStorageKey!,
        correlationId: verification.id,
      });
    } catch (error) {
      if (this.isDeterministicFailure(error)) {
        await this.rejectWithReason(
          verification,
          `Face comparison failed: ${(error as AiClientError).message}`,
        );
      }
      throw error;
    }
  }

  /** Calculate name match score between OCR extracted name and user's registered name */
  private async calculateNameMatch(
    verification: KycVerification,
    ocrResult: OcrResult,
  ): Promise<number> {
    if (!ocrResult.extractedName) {
      return 0;
    }

    const user = await this.userRepository.findOneOrFail({
      where: { id: verification.userId },
    });

    return this.computeNormalizedSimilarity(user.fullName, ocrResult.extractedName);
  }

  /** Persist AI scores on the verification entity */
  private async persistScores(
    verification: KycVerification,
    ocrResult: OcrResult,
    livenessResult: LivenessResult,
    faceResult: FaceCompareResult,
    nameMatchScore: number,
  ): Promise<void> {
    await this.kycRepository.update(verification.id, {
      ocrConfidence: ocrResult.confidence,
      faceSimilarityScore: faceResult.similarityScore,
      livenessScore: livenessResult.livenessScore,
      nameMatchScore,
      extractedName: ocrResult.extractedName,
      extractedDocumentNumber: ocrResult.extractedDocumentNumber,
      extractedExpiryDate: ocrResult.extractedExpiryDate
        ? new Date(ocrResult.extractedExpiryDate)
        : null,
      extractedDocumentType: ocrResult.extractedDocumentType,
    });
  }

  /** Evaluate all scores against thresholds and transition to final state */
  private async evaluateAndTransition(
    verification: KycVerification,
    ocrResult: OcrResult,
    livenessResult: LivenessResult,
    faceResult: FaceCompareResult,
    nameMatchScore: number,
  ): Promise<void> {
    const rejectionReasons = this.buildRejectionReasons(
      ocrResult,
      livenessResult,
      faceResult,
      nameMatchScore,
    );

    if (rejectionReasons.length > 0) {
      await this.rejectWithReason(verification, rejectionReasons.join('; '));
      return;
    }

    await this.transitionToVerified(verification);
  }

  /** Build list of rejection reasons based on threshold comparison */
  private buildRejectionReasons(
    ocrResult: OcrResult,
    livenessResult: LivenessResult,
    faceResult: FaceCompareResult,
    nameMatchScore: number,
  ): string[] {
    const reasons: string[] = [];

    if (ocrResult.confidence < this.thresholds.ocrConfidence) {
      reasons.push(
        `OCR confidence ${ocrResult.confidence} below threshold ${this.thresholds.ocrConfidence}`,
      );
    }
    if (livenessResult.livenessScore < this.thresholds.liveness) {
      reasons.push(
        `Liveness score ${livenessResult.livenessScore} below threshold ${this.thresholds.liveness}`,
      );
    }
    if (faceResult.similarityScore < this.thresholds.faceSimilarity) {
      reasons.push(
        `Face similarity ${faceResult.similarityScore} below threshold ${this.thresholds.faceSimilarity}`,
      );
    }
    if (!ocrResult.extractedName || nameMatchScore < this.thresholds.ocrConfidence) {
      reasons.push(`Name match score ${nameMatchScore} insufficient`);
    }

    return reasons;
  }

  /** Transition to VERIFIED and send notification */
  private async transitionToVerified(verification: KycVerification): Promise<void> {
    const freshVerification = await this.loadVerification(verification.id);

    await this.stateTransitionService.transition({
      targetStatus: KycStatus.VERIFIED,
      context: { verification: freshVerification },
    });

    await this.createAuditLog(
      verification.id,
      null,
      KycStatus.PROCESSING,
      KycStatus.VERIFIED,
    );

    this.logger.log(`Verification ${verification.id} completed: VERIFIED`);
    await this.sendPushNotification(verification.userId, KycStatus.VERIFIED);
  }

  /** Reject verification with a reason and send notification */
  private async rejectWithReason(verification: KycVerification, reason: string): Promise<void> {
    const freshVerification = await this.loadVerification(verification.id);

    await this.kycRepository.update(verification.id, { rejectionReason: reason });

    await this.stateTransitionService.transition({
      targetStatus: KycStatus.REJECTED,
      context: { verification: freshVerification, rejectionReason: reason },
    });

    await this.createAuditLog(
      verification.id,
      null,
      KycStatus.PROCESSING,
      KycStatus.REJECTED,
    );

    this.logger.log(`Verification ${verification.id} rejected: ${reason}`);
    await this.sendPushNotification(verification.userId, KycStatus.REJECTED);
  }

  /** Handle errors during processing — transient vs deterministic */
  private async handleProcessingError(
    error: unknown,
    verification: KycVerification,
    job: Job<KycJobPayload>,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await this.kycRepository.update(verification.id, { lastProcessingError: errorMessage });

    if (this.isDeterministicFailure(error)) {
      this.logger.warn(`Deterministic failure for ${verification.id}: ${errorMessage}`);
      return;
    }

    const isMaxRetriesExhausted = job.attemptsMade >= this.maxRetries - 1;

    if (isMaxRetriesExhausted) {
      this.logger.error(`Max retries exhausted for ${verification.id}: ${errorMessage}`);
      await this.rejectWithReason(verification, ADMIN_REVIEW_REASON);
      return;
    }

    this.logger.warn(
      `Transient failure for ${verification.id} (attempt ${job.attemptsMade + 1}/${this.maxRetries}): ${errorMessage}`,
    );
    throw error;
  }

  /** Check if an error is deterministic (non-retryable) */
  private isDeterministicFailure(error: unknown): boolean {
    if (error instanceof AiClientError) {
      return !error.isRetryable;
    }
    return false;
  }

  /**
   * Compute normalized similarity between two strings using Levenshtein distance.
   * Returns a value between 0.0 (no match) and 1.0 (exact match).
   */
  computeNormalizedSimilarity(str1: string, str2: string): number {
    const normalized1 = this.normalizeNameForComparison(str1);
    const normalized2 = this.normalizeNameForComparison(str2);

    if (normalized1 === normalized2) return 1.0;
    if (normalized1.length === 0 || normalized2.length === 0) return 0.0;

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    return 1.0 - distance / maxLength;
  }

  /** Normalize a name for comparison (lowercase, trim, collapse whitespace) */
  private normalizeNameForComparison(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-záéíóúñüàèìòùâêîôûäëïöü\s-]/g, '');
  }

  /** Calculate Levenshtein distance between two strings */
  private levenshteinDistance(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    for (let i = 0; i < rows; i++) {
      matrix[i]![0] = i;
    }
    for (let j = 0; j < cols; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j - 1]! + cost,
        );
      }
    }

    return matrix[a.length]![b.length]!;
  }

  /** Send push notification via OneSignal REST API */
  private async sendPushNotification(userId: string, status: KycStatus): Promise<void> {
    if (!this.oneSignalAppId || !this.oneSignalApiKey) {
      this.logger.debug('OneSignal not configured, skipping push notification');
      return;
    }

    try {
      const message = status === KycStatus.VERIFIED
        ? NOTIFICATION_CONTENT[NOTIFICATION_VERIFIED_KEY]
        : NOTIFICATION_CONTENT[NOTIFICATION_REJECTED_KEY];

      await axios.post(
        this.oneSignalApiUrl,
        {
          app_id: this.oneSignalAppId,
          include_external_user_ids: [userId],
          contents: { en: message },
          headings: { en: NOTIFICATION_CONTENT[NOTIFICATION_HEADING_KEY] },
          data: { type: 'kyc_status_change', status },
        },
        {
          headers: {
            Authorization: `Basic ${this.oneSignalApiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`Push notification sent to user ${userId} for status ${status}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to send push notification: ${errorMsg}`);
    }
  }

  /** Create an audit log entry for state transitions */
  private async createAuditLog(
    verificationId: string,
    actorId: string | null,
    oldStatus: KycStatus,
    newStatus: KycStatus,
  ): Promise<void> {
    await this.kycAuditService.logStateTransition({
      verificationId,
      actorId,
      oldStatus,
      newStatus,
      metadata: { triggeredBy: AUDIT_METADATA_TRIGGER },
    });
  }
}

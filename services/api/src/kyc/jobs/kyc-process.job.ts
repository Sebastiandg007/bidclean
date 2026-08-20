import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * KYC processing job.
 * Handles async verification pipeline: OCR → liveness → face comparison → scoring.
 * Enqueued by KycService after selfie upload.
 * Uses BullMQ with configurable retries and exponential backoff.
 */
@Injectable()
export class KycProcessJob {
  readonly maxRetries: number;
  readonly backoffMs: number;

  constructor(private readonly configService: ConfigService) {
    this.maxRetries = parseInt(
      this.configService.getOrThrow<string>('KYC_PROCESSING_MAX_RETRIES'),
      10,
    );
    this.backoffMs = parseInt(
      this.configService.getOrThrow<string>('KYC_PROCESSING_BACKOFF_MS'),
      10,
    );
  }

  /**
   * Process a KYC verification.
   * Pipeline short-circuits on deterministic failures.
   * @param verificationId - UUID of the verification to process
   */
  async process(verificationId: string): Promise<void> {
    // TODO: Implement processing pipeline:
    // 1. Call AI service OCR (short-circuit if fails)
    // 2. Call AI service liveness (short-circuit if fails)
    // 3. Call AI service face compare
    // 4. Evaluate scores against thresholds
    // 5. Update verification status (VERIFIED / REJECTED)
    // 6. Send push notification via OneSignal
    void verificationId;
    throw new Error('Not implemented');
  }
}

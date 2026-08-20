import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * KYC cleanup job.
 * Handles automatic deletion of document/selfie images after configurable retention period.
 * Runs as a scheduled cron job. Deletion is idempotent.
 */
@Injectable()
export class KycCleanupJob {
  readonly retentionDays: number;

  constructor(private readonly configService: ConfigService) {
    this.retentionDays = parseInt(
      this.configService.getOrThrow<string>('KYC_IMAGE_RETENTION_DAYS'),
      10,
    );
  }

  /**
   * Run cleanup for expired KYC images.
   * Finds verifications with images older than retention period and deletes them.
   * Idempotent — re-running is safe.
   */
  async run(): Promise<void> {
    // TODO: Implement cleanup logic:
    // 1. Query verifications with images older than retention period
    // 2. Delete images from MinIO storage (idempotent)
    // 3. Clear storage keys from verification records
    // 4. Log audit entries for each deletion
    throw new Error('Not implemented');
  }
}

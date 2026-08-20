import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycAuditLog } from '../entities/kyc-audit-log.entity';
import { KycStorageService } from '../storage/kyc-storage.service';

/** Batch size for processing deletions to avoid overwhelming MinIO */
const CLEANUP_BATCH_SIZE = 50;

/** Audit log actions for cleanup operations */
const AUDIT_ACTION_DOCUMENT_DELETED = 'DOCUMENT_DELETED';
const AUDIT_ACTION_SELFIE_DELETED = 'SELFIE_DELETED';

/** Metadata trigger identifier */
const AUDIT_METADATA_TRIGGER = 'kyc-cleanup-job';

/**
 * KYC cleanup job.
 * Handles automatic deletion of document/selfie images after configurable retention period.
 * Runs as a scheduled cron job (daily at 3:00 AM). Deletion is idempotent.
 *
 * Finds verifications with stored images older than KYC_RETENTION_DAYS,
 * deletes images from MinIO, clears storage keys, and logs audit entries.
 */
@Injectable()
export class KycCleanupJob {
  private readonly logger = new Logger(KycCleanupJob.name);
  readonly retentionDays: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(KycVerification)
    private readonly kycRepository: Repository<KycVerification>,
    @InjectRepository(KycAuditLog)
    private readonly auditLogRepository: Repository<KycAuditLog>,
    private readonly storageService: KycStorageService,
  ) {
    this.retentionDays = parseInt(
      this.configService.getOrThrow<string>('KYC_RETENTION_DAYS'),
      10,
    );
  }

  /**
   * Scheduled cron job — runs daily at 3:00 AM.
   * Finds expired verifications and deletes their images.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    this.logger.log(`Starting KYC image cleanup (retention: ${this.retentionDays} days)`);

    const cutoffDate = this.calculateCutoffDate();
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.findExpiredVerifications(cutoffDate);

      if (batch.length === 0) {
        break;
      }

      const batchDeleted = await this.processBatch(batch);
      totalDeleted += batchDeleted;

      if (batch.length < CLEANUP_BATCH_SIZE) {
        hasMore = false;
      }
    }

    this.logger.log(`KYC cleanup complete: ${totalDeleted} images deleted`);
  }

  /**
   * Calculate the cutoff date based on retention days.
   * Verifications completed/created before this date are eligible for cleanup.
   */
  private calculateCutoffDate(): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    return cutoff;
  }

  /**
   * Find verifications with images older than the cutoff date.
   * Looks for records where completedAt or createdAt is before the cutoff
   * AND at least one storage key is present.
   */
  private async findExpiredVerifications(cutoffDate: Date): Promise<KycVerification[]> {
    return this.kycRepository
      .createQueryBuilder('v')
      .where(
        '(v.completedAt IS NOT NULL AND v.completedAt < :cutoff) OR ' +
        '(v.completedAt IS NULL AND v.createdAt < :cutoff)',
        { cutoff: cutoffDate },
      )
      .andWhere(
        '(v.documentStorageKey IS NOT NULL OR v.selfieStorageKey IS NOT NULL)',
      )
      .take(CLEANUP_BATCH_SIZE)
      .getMany();
  }

  /**
   * Process a batch of verifications — delete images and clear keys.
   * Each deletion is independent; failures don't stop other deletions.
   */
  private async processBatch(verifications: KycVerification[]): Promise<number> {
    let deletedCount = 0;

    for (const verification of verifications) {
      const deleted = await this.processVerification(verification);
      deletedCount += deleted;
    }

    return deletedCount;
  }

  /**
   * Process a single verification: delete document and/or selfie images.
   * Returns the number of images successfully deleted.
   */
  private async processVerification(verification: KycVerification): Promise<number> {
    let deleted = 0;

    if (verification.documentStorageKey) {
      const success = await this.deleteImage(
        verification.id,
        verification.documentStorageKey,
        AUDIT_ACTION_DOCUMENT_DELETED,
      );
      if (success) {
        await this.kycRepository.update(verification.id, { documentStorageKey: null });
        deleted++;
      }
    }

    if (verification.selfieStorageKey) {
      const success = await this.deleteImage(
        verification.id,
        verification.selfieStorageKey,
        AUDIT_ACTION_SELFIE_DELETED,
      );
      if (success) {
        await this.kycRepository.update(verification.id, { selfieStorageKey: null });
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Delete a single image from MinIO and create an audit log entry.
   * Idempotent — succeeds even if the object is already deleted.
   * Returns true on success, false on error.
   */
  private async deleteImage(
    verificationId: string,
    storageKey: string,
    action: string,
  ): Promise<boolean> {
    try {
      await this.storageService.delete({ key: storageKey });
      await this.createAuditLog(verificationId, action, storageKey);
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to delete image ${storageKey} for verification ${verificationId}: ${errorMessage}`,
      );
      return false;
    }
  }

  /**
   * Create an audit log entry for an image deletion.
   */
  private async createAuditLog(
    verificationId: string,
    action: string,
    storageKey: string,
  ): Promise<void> {
    const log = this.auditLogRepository.create({
      verificationId,
      action,
      actorId: null,
      oldStatus: null,
      newStatus: null,
      metadata: {
        triggeredBy: AUDIT_METADATA_TRIGGER,
        storageKey,
        retentionDays: this.retentionDays,
      },
    });
    await this.auditLogRepository.save(log);
  }
}

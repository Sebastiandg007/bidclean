import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as Minio from 'minio';
import { KeycloakService } from '../../auth/keycloak/keycloak.service';
import { User } from '../../auth/entities/user.entity';
import { DeletionJobPayload } from '../profile.types';
import { DeletionStep, DeletionAuditEntry } from './account.types';

/** BullMQ queue name for account deletion */
const ACCOUNT_DELETION_QUEUE = 'account-deletion';

/** Anonymized display name for deleted users */
const ANONYMIZED_DISPLAY_NAME = 'Deleted User';

/** Default RevenueCat API base URL */
const DEFAULT_REVENUECAT_API_URL = 'https://api.revenuecat.com/v1';

/** Default MinIO endpoint for local development */
const DEFAULT_MINIO_ENDPOINT = 'http://localhost:9000';

/** Default MinIO profile photos bucket */
const DEFAULT_MINIO_BUCKET = 'profile-photos';

/**
 * BullMQ job processor for async account deletion.
 * Executes the deletion cascade: cancel subscriptions → delete Keycloak →
 * delete MinIO → anonymize PII → mark DELETED.
 * Each step is idempotent with structured audit logging.
 */
@Processor(ACCOUNT_DELETION_QUEUE)
export class DeletionJobProcessor extends WorkerHost {
  private readonly logger = new Logger(DeletionJobProcessor.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly revenueCatApiKey: string;
  private readonly revenueCatApiUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly keycloakService: KeycloakService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {
    super();

    const endpoint = this.configService.get<string>('MINIO_ENDPOINT', DEFAULT_MINIO_ENDPOINT);
    const parsedUrl = new URL(endpoint);

    this.minioClient = new Minio.Client({
      endPoint: parsedUrl.hostname,
      port: parseInt(parsedUrl.port, 10) || (parsedUrl.protocol === 'https:' ? 443 : 9000),
      useSSL: parsedUrl.protocol === 'https:',
      accessKey: this.configService.get<string>('MINIO_ROOT_USER', ''),
      secretKey: this.configService.get<string>('MINIO_ROOT_PASSWORD', ''),
    });

    this.bucketName = this.configService.get<string>(
      'MINIO_PROFILE_PHOTOS_BUCKET',
      DEFAULT_MINIO_BUCKET,
    );

    this.revenueCatApiKey = this.configService.get<string>('REVENUECAT_API_KEY', '');
    this.revenueCatApiUrl = this.configService.get<string>(
      'REVENUECAT_API_URL',
      DEFAULT_REVENUECAT_API_URL,
    );
  }

  /**
   * Main process method invoked by BullMQ worker.
   * Executes all deletion cascade steps in order.
   */
  async process(job: Job<DeletionJobPayload>): Promise<void> {
    const { userId, keycloakId, idempotencyKey } = job.data;

    this.logger.log(
      `Starting account deletion cascade for user ${userId} (idempotencyKey: ${idempotencyKey})`,
    );

    await this.executeCancelSubscriptions(userId);
    await this.executeCleanupSubscriptionMirror(userId);
    await this.executeDeleteKeycloak(keycloakId);
    await this.executeDeleteMinioFiles(userId);
    await this.executeAnonymizePii(userId);
    await this.executeMarkDeleted(userId);

    this.logger.log(`Account deletion cascade completed for user ${userId}`);
  }

  /**
   * Step 1: Cancel active RevenueCat subscriptions.
   * Skips gracefully if no subscriptions exist or RevenueCat is not configured.
   */
  private async executeCancelSubscriptions(userId: string): Promise<void> {
    const audit = this.startAudit('CANCEL_SUBSCRIPTIONS');

    try {
      if (!this.revenueCatApiKey) {
        this.logger.warn('RevenueCat not configured — skipping subscription cancellation');
        this.completeAudit(audit);
        return;
      }

      await this.cancelRevenueCatSubscriptions(userId);
      this.completeAudit(audit);
    } catch (error: unknown) {
      this.handleStepError(audit, error, 'CANCEL_SUBSCRIPTIONS');
    }
  }

  /**
   * Step 2: Clean up the local subscription mirror + ledger.
   * Removes the mirror row (its per-user runtime read model) and anonymizes the append-only
   * ledger (user_id -> NULL) so audit history survives deletion. Idempotent, never blocks on
   * RevenueCat, safe to retry.
   */
  private async executeCleanupSubscriptionMirror(userId: string): Promise<void> {
    const audit = this.startAudit('CLEANUP_SUBSCRIPTION_MIRROR');

    try {
      await this.cleanupSubscriptionMirror(userId);
      this.completeAudit(audit);
    } catch (error: unknown) {
      this.handleStepError(audit, error, 'CLEANUP_SUBSCRIPTION_MIRROR');
    }
  }

  /**
   * Step 3: Permanently delete user from Keycloak.
   * Skips gracefully if user is already deleted (404).
   */
  private async executeDeleteKeycloak(keycloakId: string): Promise<void> {
    const audit = this.startAudit('DELETE_KEYCLOAK');

    try {
      await this.keycloakService.deleteUser(keycloakId);
      this.completeAudit(audit);
    } catch (error: unknown) {
      this.handleStepError(audit, error, 'DELETE_KEYCLOAK');
    }
  }

  /**
   * Step 4: Delete all user files from MinIO (profile photo + portfolio).
   * Skips gracefully if no objects exist.
   */
  private async executeDeleteMinioFiles(userId: string): Promise<void> {
    const audit = this.startAudit('DELETE_MINIO');

    try {
      await this.deleteAllUserObjects(userId);
      this.completeAudit(audit);
    } catch (error: unknown) {
      this.handleStepError(audit, error, 'DELETE_MINIO');
    }
  }

  /**
   * Step 5: Anonymize all PII in the database.
   * Sets email, phone, display name, photo key, and bio to anonymized values.
   */
  private async executeAnonymizePii(userId: string): Promise<void> {
    const audit = this.startAudit('ANONYMIZE_PII');

    try {
      await this.anonymizeUserPii(userId);
      this.completeAudit(audit);
    } catch (error: unknown) {
      this.handleStepError(audit, error, 'ANONYMIZE_PII');
    }
  }

  /**
   * Step 6: Mark user as DELETED in the users table.
   * Idempotent — succeeds even if already marked.
   */
  private async executeMarkDeleted(userId: string): Promise<void> {
    const audit = this.startAudit('MARK_DELETED');

    try {
      await this.userRepository.update(userId, { deletionStatus: 'DELETED' });
      this.completeAudit(audit);
    } catch (error: unknown) {
      this.handleStepError(audit, error, 'MARK_DELETED');
    }
  }

  // ---------------------------------------------------------------------------
  // RevenueCat Integration
  // ---------------------------------------------------------------------------

  /**
   * Calls RevenueCat REST API to revoke subscriber access (cancel subscriptions).
   * Uses DELETE /v1/subscribers/{app_user_id} endpoint.
   * Gracefully handles 404 (no subscriber found).
   */
  private async cancelRevenueCatSubscriptions(userId: string): Promise<void> {
    const url = `${this.revenueCatApiUrl}/subscribers/${userId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.revenueCatApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      this.logger.log(`No RevenueCat subscriber found for user ${userId} — skipping`);
      return;
    }

    if (!response.ok) {
      const body = await this.safeReadBody(response);
      throw new Error(`RevenueCat API error ${response.status}: ${body}`);
    }

    this.logger.log(`RevenueCat subscriptions cancelled for user ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // MinIO File Deletion
  // ---------------------------------------------------------------------------

  /**
   * Lists and removes all objects under the user's prefix in MinIO.
   * Handles the case where no objects exist.
   */
  private async deleteAllUserObjects(userId: string): Promise<void> {
    const prefix = `${userId}/`;
    const objectKeys = await this.listObjectKeys(prefix);

    if (objectKeys.length === 0) {
      this.logger.log(`No MinIO objects found for user ${userId}`);
      return;
    }

    await this.minioClient.removeObjects(this.bucketName, objectKeys);
    this.logger.log(`Deleted ${objectKeys.length} MinIO objects for user ${userId}`);
  }

  /**
   * Lists all object keys under a given prefix.
   */
  private listObjectKeys(prefix: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = [];
      const stream = this.minioClient.listObjects(this.bucketName, prefix, true);

      stream.on('data', (obj) => {
        if (obj.name) {
          keys.push(obj.name);
        }
      });
      stream.on('end', () => resolve(keys));
      stream.on('error', (err) => reject(err));
    });
  }

  // ---------------------------------------------------------------------------
  // PII Anonymization
  // ---------------------------------------------------------------------------

  /**
   * Anonymizes user PII in the database using a transaction.
   * - users.email → NULL
   * - profile_details.phone_number → NULL
   * - profile_details.display_name → "Deleted User"
   * - profile_details.photo_storage_key → NULL
   * - profile_details.bio → NULL
   */
  private async anonymizeUserPii(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE users SET email = NULL WHERE id = $1`,
        [userId],
      );

      await manager.query(
        `UPDATE profile_details
         SET phone_number = NULL,
             display_name = $2,
             photo_storage_key = NULL,
             bio = NULL
         WHERE user_id = $1`,
        [userId, ANONYMIZED_DISPLAY_NAME],
      );
    });

    this.logger.log(`PII anonymized for user ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // Subscription Mirror Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Removes the subscription mirror row and anonymizes the append-only ledger for a user.
   *
   * The mirror is a disposable runtime read model (hard-deleted); the ledger is audit history
   * that must survive deletion, so its `user_id` is nulled rather than the rows removed (the
   * ledger deliberately has no FK to `users`). Both statements run in one transaction and are
   * idempotent (a missing mirror row / already-anonymized ledger is a no-op).
   */
  private async cleanupSubscriptionMirror(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
      await manager.query(
        `UPDATE subscription_events SET user_id = NULL WHERE user_id = $1`,
        [userId],
      );
    });

    this.logger.log(`Subscription mirror cleaned up for user ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // Audit Logging Helpers
  // ---------------------------------------------------------------------------

  /**
   * Creates and logs a STARTED audit entry for a step.
   */
  private startAudit(step: DeletionStep): DeletionAuditEntry {
    const entry: DeletionAuditEntry = {
      step,
      status: 'STARTED',
      timestamp: new Date(),
    };

    this.logger.log(`[DELETION AUDIT] Step ${step}: STARTED`);
    return entry;
  }

  /**
   * Logs a COMPLETED audit entry for a step.
   */
  private completeAudit(entry: DeletionAuditEntry): void {
    this.logger.log(`[DELETION AUDIT] Step ${entry.step}: COMPLETED`);
  }

  /**
   * Handles step errors: logs the failure audit entry and re-throws
   * transient errors to trigger BullMQ retry.
   */
  private handleStepError(
    _audit: DeletionAuditEntry,
    error: unknown,
    step: DeletionStep,
  ): void {
    const message = error instanceof Error ? error.message : String(error);

    this.logger.error(`[DELETION AUDIT] Step ${step}: FAILED — ${message}`);

    // Re-throw to trigger BullMQ retry on transient errors
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Deletion step ${step} failed: ${message}`);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Safely read a response body as text.
   */
  private async safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '<unable to read response body>';
    }
  }
}

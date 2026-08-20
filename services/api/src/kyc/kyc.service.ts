import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycAuditLog } from './entities/kyc-audit-log.entity';
import { KycStatus, KycStatusResponse } from './kyc.types';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { KycStorageService } from './storage/kyc-storage.service';
import { StorageCategory } from './storage/kyc-storage.types';
import { KycStateTransitionService } from './state-machine/kyc-state-transition.service';
import { KycProcessJob } from './jobs/kyc-process.job';
import { User } from '../auth/entities/user.entity';

/** Multer file shape received from controller */
interface UploadedFile {
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/** Allowed MIME types for document upload */
const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/**
 * KYC verification service.
 * Orchestrates the KYC flow: document upload, selfie upload, processing trigger, retry.
 */
@Injectable()
export class KycService {
  readonly maxAttempts: number;
  private readonly maxFileSizeBytes: number;

  constructor(
    @InjectRepository(KycVerification)
    readonly kycRepository: Repository<KycVerification>,
    @InjectRepository(KycAuditLog)
    private readonly auditLogRepository: Repository<KycAuditLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly storageService: KycStorageService,
    private readonly stateTransitionService: KycStateTransitionService,
    private readonly kycProcessJob: KycProcessJob,
    @InjectQueue('kyc-processing')
    private readonly kycProcessingQueue: Queue,
  ) {
    this.maxAttempts = parseInt(
      this.configService.getOrThrow<string>('KYC_MAX_ATTEMPTS'),
      10,
    );
    const maxFileSizeMb = parseInt(
      this.configService.getOrThrow<string>('KYC_MAX_FILE_SIZE_MB'),
      10,
    );
    this.maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
  }

  /**
   * Upload an identity document image.
   * Validates role, file, transitions state, and creates audit log.
   */
  async uploadDocument(
    keycloakId: string,
    dto: UploadDocumentDto,
    file: UploadedFile,
    idempotencyKey?: string,
  ): Promise<KycStatusResponse> {
    const user = await this.findUserByKeycloakId(keycloakId);
    this.assertCleanerRole(user);
    this.validateFileType(file.mimetype);
    this.validateFileSize(file.size);

    const verification = await this.getOrCreateVerification(user.id);

    if (this.isIdempotentUpload(verification, idempotencyKey)) {
      return this.buildStatusResponse(verification);
    }

    this.assertNotAlreadyVerified(verification);

    const uploadResult = await this.storageService.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      userId: user.id,
      category: StorageCategory.DOCUMENT,
    });

    const transitionResult = await this.stateTransitionService.transition({
      targetStatus: KycStatus.DOCUMENT_UPLOADED,
      context: {
        verification,
        documentStorageKey: uploadResult.key,
      },
    });

    await this.updateVerificationDocument(
      verification.id,
      dto.documentType,
      uploadResult.key,
    );

    await this.createAuditLog(
      verification.id,
      user.id,
      transitionResult.previousStatus,
      transitionResult.newStatus,
    );

    const updated = await this.kycRepository.findOneOrFail({
      where: { id: verification.id },
    });

    return this.buildStatusResponse(updated);
  }

  /**
   * Upload a selfie image and enqueue processing.
   * Validates role, file, transitions state, creates audit log, and enqueues BullMQ job.
   */
  async uploadSelfie(
    keycloakId: string,
    file: UploadedFile,
    idempotencyKey?: string,
  ): Promise<KycStatusResponse> {
    const user = await this.findUserByKeycloakId(keycloakId);
    this.assertCleanerRole(user);
    this.validateFileType(file.mimetype);
    this.validateFileSize(file.size);

    const verification = await this.getLatestVerification(user.id);
    this.assertDocumentUploaded(verification);

    if (this.isIdempotentSelfieUpload(verification, idempotencyKey)) {
      return this.buildStatusResponse(verification);
    }

    this.assertNotAlreadyVerified(verification);

    const uploadResult = await this.storageService.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      userId: user.id,
      category: StorageCategory.SELFIE,
    });

    const transitionResult = await this.stateTransitionService.transition({
      targetStatus: KycStatus.SELFIE_UPLOADED,
      context: {
        verification,
        selfieStorageKey: uploadResult.key,
      },
    });

    await this.updateVerificationSelfie(verification.id, uploadResult.key);

    await this.createAuditLog(
      verification.id,
      user.id,
      transitionResult.previousStatus,
      transitionResult.newStatus,
    );

    await this.enqueueProcessingJob(verification.id);

    const updated = await this.kycRepository.findOneOrFail({
      where: { id: verification.id },
    });

    return this.buildStatusResponse(updated);
  }

  /**
   * Get current KYC verification status for a user.
   * Derived from the latest attempt (highest attempt_number).
   */
  async getStatus(keycloakId: string): Promise<KycStatusResponse> {
    const user = await this.findUserByKeycloakId(keycloakId);
    this.assertCleanerRole(user);

    const latestVerification = await this.kycRepository.findOne({
      where: { userId: user.id },
      order: { attemptNumber: 'DESC' },
    });

    if (!latestVerification) {
      return {
        status: KycStatus.NOT_STARTED,
        attemptNumber: 1,
        rejectionReason: null,
        completedAt: null,
      };
    }

    return this.buildStatusResponse(latestVerification);
  }

  /**
   * Start a new verification attempt (retry).
   */
  async retry(userId: string) {
    // TODO: Implement retry logic
    void userId;
    throw new Error('Not implemented');
  }

  /** Look up user by Keycloak ID, throw if not found */
  private async findUserByKeycloakId(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('kyc.error.not_cleaner');
    }
    return user;
  }

  /** Verify user has cleaner role */
  private assertCleanerRole(user: User): void {
    if (!user.roles.includes('cleaner')) {
      throw new ForbiddenException('kyc.error.not_cleaner');
    }
  }

  /** Validate file MIME type against allowed list */
  private validateFileType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException('kyc.error.invalid_file_type');
    }
  }

  /** Validate file size against configured max */
  private validateFileSize(size: number): void {
    if (size > this.maxFileSizeBytes) {
      throw new PayloadTooLargeException('kyc.error.file_too_large');
    }
  }

  /** Get the latest verification attempt or create the first one */
  private async getOrCreateVerification(userId: string): Promise<KycVerification> {
    const existing = await this.kycRepository.findOne({
      where: { userId },
      order: { attemptNumber: 'DESC' },
    });

    if (existing) {
      return existing;
    }

    const created = this.kycRepository.create({
      userId,
      status: KycStatus.NOT_STARTED,
      attemptNumber: 1,
    });

    return this.kycRepository.save(created);
  }

  /** Check if this is an idempotent re-upload (document already uploaded) */
  private isIdempotentUpload(
    verification: KycVerification,
    idempotencyKey?: string,
  ): boolean {
    if (!idempotencyKey) return false;

    return (
      verification.status === KycStatus.DOCUMENT_UPLOADED &&
      verification.documentStorageKey !== null
    );
  }

  /** Check if this is an idempotent selfie re-upload */
  private isIdempotentSelfieUpload(
    verification: KycVerification,
    idempotencyKey?: string,
  ): boolean {
    if (!idempotencyKey) return false;

    const isAlreadyUploaded =
      verification.status === KycStatus.SELFIE_UPLOADED ||
      verification.status === KycStatus.PROCESSING;

    return isAlreadyUploaded && verification.selfieStorageKey !== null;
  }

  /** Get the latest verification for a user — throws ConflictException if none exists */
  private async getLatestVerification(userId: string): Promise<KycVerification> {
    const verification = await this.kycRepository.findOne({
      where: { userId },
      order: { attemptNumber: 'DESC' },
    });

    if (!verification) {
      throw new ConflictException('kyc.error.document_not_uploaded');
    }

    return verification;
  }

  /** Assert the verification has document uploaded (prerequisite for selfie) */
  private assertDocumentUploaded(verification: KycVerification): void {
    if (
      verification.status === KycStatus.NOT_STARTED ||
      !verification.documentStorageKey
    ) {
      throw new ConflictException('kyc.error.document_not_uploaded');
    }
  }

  /** Update the verification record with selfie storage key */
  private async updateVerificationSelfie(
    verificationId: string,
    storageKey: string,
  ): Promise<void> {
    await this.kycRepository.update(verificationId, {
      selfieStorageKey: storageKey,
    });
  }

  /** Enqueue a BullMQ processing job for the verification */
  private async enqueueProcessingJob(verificationId: string): Promise<void> {
    await this.kycProcessingQueue.add(
      'process-verification',
      { verificationId },
      {
        attempts: this.kycProcessJob.maxRetries,
        backoff: {
          type: 'exponential',
          delay: this.kycProcessJob.backoffMs,
        },
      },
    );
  }

  /** Throw if verification is already in VERIFIED state */
  private assertNotAlreadyVerified(verification: KycVerification): void {
    if (verification.status === KycStatus.VERIFIED) {
      throw new ConflictException('kyc.error.already_verified');
    }
  }

  /** Update the verification record with document metadata */
  private async updateVerificationDocument(
    verificationId: string,
    documentType: string,
    storageKey: string,
  ): Promise<void> {
    await this.kycRepository.update(verificationId, {
      documentType: documentType as KycVerification['documentType'],
      documentStorageKey: storageKey,
    });
  }

  /** Create an audit log entry for the state transition */
  private async createAuditLog(
    verificationId: string,
    actorId: string,
    oldStatus: KycStatus,
    newStatus: KycStatus,
  ): Promise<void> {
    const log = this.auditLogRepository.create({
      verificationId,
      action: 'STATE_TRANSITION',
      actorId,
      oldStatus,
      newStatus,
      metadata: null,
    });
    await this.auditLogRepository.save(log);
  }

  /** Build the status response DTO from a verification entity */
  private buildStatusResponse(verification: KycVerification): KycStatusResponse {
    return {
      status: verification.status,
      attemptNumber: verification.attemptNumber,
      rejectionReason: verification.rejectionReason,
      completedAt: verification.completedAt,
    };
  }
}

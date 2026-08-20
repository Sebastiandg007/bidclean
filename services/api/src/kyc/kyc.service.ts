import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycStatusResponse } from './kyc.types';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UploadSelfieDto } from './dto/upload-selfie.dto';

/**
 * KYC verification service.
 * Orchestrates the KYC flow: document upload, selfie upload, processing trigger, retry.
 */
@Injectable()
export class KycService {
  readonly maxAttempts: number;

  constructor(
    @InjectRepository(KycVerification)
    readonly kycRepository: Repository<KycVerification>,
    private readonly configService: ConfigService,
  ) {
    this.maxAttempts = parseInt(
      this.configService.getOrThrow<string>('KYC_MAX_ATTEMPTS'),
      10,
    );
  }

  /**
   * Upload an identity document image.
   * @param userId - Authenticated user ID
   * @param dto - Document upload metadata
   * @param file - Image file buffer
   * @returns Updated verification record
   */
  async uploadDocument(userId: string, dto: UploadDocumentDto, file: Buffer) {
    // TODO: Implement document upload flow:
    // 1. Validate state (must be NOT_STARTED)
    // 2. Store encrypted in MinIO
    // 3. Transition state to DOCUMENT_UPLOADED
    // 4. Create audit log entry
    void userId;
    void dto;
    void file;
    throw new Error('Not implemented');
  }

  /**
   * Upload a selfie image and enqueue processing.
   * @param userId - Authenticated user ID
   * @param dto - Selfie upload metadata
   * @param file - Image file buffer
   * @returns Updated verification record
   */
  async uploadSelfie(userId: string, dto: UploadSelfieDto, file: Buffer) {
    // TODO: Implement selfie upload flow:
    // 1. Validate state (must be DOCUMENT_UPLOADED)
    // 2. Store encrypted in MinIO
    // 3. Transition state to SELFIE_UPLOADED
    // 4. Enqueue BullMQ processing job
    // 5. Create audit log entry
    void userId;
    void dto;
    void file;
    throw new Error('Not implemented');
  }

  /**
   * Get current KYC verification status for a user.
   * Derived from the latest attempt (highest attempt_number).
   * @param userId - Authenticated user ID
   * @returns Current status response
   */
  async getStatus(userId: string): Promise<KycStatusResponse> {
    // TODO: Implement status retrieval from latest attempt
    void userId;
    throw new Error('Not implemented');
  }

  /**
   * Start a new verification attempt (retry).
   * Creates a new attempt record — does not modify previous attempts.
   * @param userId - Authenticated user ID
   * @returns New verification record
   */
  async retry(userId: string) {
    // TODO: Implement retry logic:
    // 1. Validate current status is REJECTED
    // 2. Check max attempts not exceeded
    // 3. Create new attempt with incremented attempt_number
    // 4. Create audit log entry
    void userId;
    throw new Error('Not implemented');
  }
}

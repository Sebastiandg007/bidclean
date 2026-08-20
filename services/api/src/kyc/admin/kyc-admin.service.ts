import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycVerification } from '../entities/kyc-verification.entity';
import { AdminDecisionDto } from '../dto/admin-decision.dto';
import {
  KycStatus,
  KycQueueItem,
  KycVerificationDetail,
} from '../kyc.types';

/** Pagination defaults */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Paginated response for the admin review queue */
export interface PaginatedQueueResponse {
  readonly items: KycQueueItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

/**
 * Admin KYC service.
 * Handles admin review queue, verification details, and approve/reject decisions.
 */
@Injectable()
export class KycAdminService {
  constructor(
    @InjectRepository(KycVerification)
    readonly kycRepository: Repository<KycVerification>,
  ) {}

  /**
   * Get pending verifications for admin review.
   * Returns PROCESSING and REJECTED verifications sorted oldest-first.
   * @param page - Page number (1-based, default 1)
   * @param limit - Items per page (default 20, max 100)
   * @returns Paginated list of verifications needing review
   */
  async getReviewQueue(
    page?: number,
    limit?: number,
  ): Promise<PaginatedQueueResponse> {
    const safePage = Math.max(page ?? DEFAULT_PAGE, 1);
    const safeLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = (safePage - 1) * safeLimit;

    const [items, total] = await this.kycRepository
      .createQueryBuilder('v')
      .select([
        'v.id',
        'v.userId',
        'v.status',
        'v.attemptNumber',
        'v.documentType',
        'v.createdAt',
        'v.processingStartedAt',
      ])
      .where('v.status IN (:...statuses)', {
        statuses: [KycStatus.PROCESSING, KycStatus.REJECTED],
      })
      .orderBy('v.createdAt', 'ASC')
      .skip(offset)
      .take(safeLimit)
      .getManyAndCount();

    const queueItems: KycQueueItem[] = items.map((v) => ({
      id: v.id,
      userId: v.userId,
      status: v.status,
      attemptNumber: v.attemptNumber,
      documentType: v.documentType,
      createdAt: v.createdAt,
      processingStartedAt: v.processingStartedAt,
    }));

    return {
      items: queueItems,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Get full verification details for admin review.
   * @param verificationId - Verification UUID
   * @returns Detailed verification record
   * @throws NotFoundException when verification does not exist
   */
  async getVerificationDetail(
    verificationId: string,
  ): Promise<KycVerificationDetail> {
    const verification = await this.kycRepository.findOne({
      where: { id: verificationId },
    });

    if (!verification) {
      throw new NotFoundException('kyc.error.verification_not_found');
    }

    return {
      id: verification.id,
      userId: verification.userId,
      status: verification.status,
      attemptNumber: verification.attemptNumber,
      documentType: verification.documentType,
      extractedName: verification.extractedName,
      extractedDocumentNumber: verification.extractedDocumentNumber,
      extractedExpiryDate: verification.extractedExpiryDate,
      ocrConfidence: verification.ocrConfidence,
      faceSimilarityScore: verification.faceSimilarityScore,
      livenessScore: verification.livenessScore,
      nameMatchScore: verification.nameMatchScore,
      rejectionReason: verification.rejectionReason,
      reviewedBy: verification.reviewedBy,
      reviewedAt: verification.reviewedAt,
      createdAt: verification.createdAt,
      updatedAt: verification.updatedAt,
    };
  }

  /**
   * Approve or reject a verification.
   * @param verificationId - Verification UUID
   * @param dto - Admin decision (approve/reject with reason)
   * @returns Updated verification record
   */
  async makeDecision(verificationId: string, dto: AdminDecisionDto) {
    // TODO: Implement decision logic with state transition and audit logging
    void verificationId;
    void dto;
    throw new Error('Not implemented');
  }
}

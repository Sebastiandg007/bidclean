import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycVerification } from '../entities/kyc-verification.entity';
import { AdminDecisionDto, AdminDecision } from '../dto/admin-decision.dto';
import { KycStateTransitionService } from '../state-machine/kyc-state-transition.service';
import { KycAuditService, AuditAction } from '../kyc-audit.service';
import { KycNotificationService } from '../kyc-notification.service';
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
    private readonly kycRepository: Repository<KycVerification>,
    private readonly stateTransitionService: KycStateTransitionService,
    private readonly kycAuditService: KycAuditService,
    private readonly kycNotificationService: KycNotificationService,
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
   * Logs OCR_VIEWED access for GDPR compliance.
   * @param verificationId - Verification UUID
   * @param adminUserId - ID of the admin viewing the detail
   * @returns Detailed verification record
   * @throws NotFoundException when verification does not exist
   */
  async getVerificationDetail(
    verificationId: string,
    adminUserId?: string,
  ): Promise<KycVerificationDetail> {
    const verification = await this.kycRepository.findOne({
      where: { id: verificationId },
    });

    if (!verification) {
      throw new NotFoundException('kyc.error.verification_not_found');
    }

    if (adminUserId) {
      await this.kycAuditService.logDataAccess({
        verificationId,
        actorId: adminUserId,
        action: AuditAction.OCR_VIEWED,
        metadata: { viewedFields: ['ocrConfidence', 'extractedName', 'faceSimilarityScore', 'livenessScore'] },
      });
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
   * Get document image URL for admin review.
   * Logs DOCUMENT_VIEWED for GDPR compliance.
   * @param verificationId - Verification UUID
   * @param adminUserId - ID of the admin viewing the document
   * @returns Object with presigned URL for the document image
   * @throws NotFoundException when verification or document not found
   */
  async getDocumentImage(
    verificationId: string,
    adminUserId: string,
  ): Promise<{ url: string }> {
    const verification = await this.findVerificationOrFail(verificationId);

    if (!verification.documentStorageKey) {
      throw new NotFoundException('kyc.error.document_not_found');
    }

    await this.kycAuditService.logDataAccess({
      verificationId,
      actorId: adminUserId,
      action: AuditAction.DOCUMENT_VIEWED,
      metadata: { storageKey: verification.documentStorageKey },
    });

    return { url: verification.documentStorageKey };
  }

  /**
   * Get selfie image URL for admin review.
   * Logs SELFIE_VIEWED for GDPR compliance.
   * @param verificationId - Verification UUID
   * @param adminUserId - ID of the admin viewing the selfie
   * @returns Object with presigned URL for the selfie image
   * @throws NotFoundException when verification or selfie not found
   */
  async getSelfieImage(
    verificationId: string,
    adminUserId: string,
  ): Promise<{ url: string }> {
    const verification = await this.findVerificationOrFail(verificationId);

    if (!verification.selfieStorageKey) {
      throw new NotFoundException('kyc.error.selfie_not_found');
    }

    await this.kycAuditService.logDataAccess({
      verificationId,
      actorId: adminUserId,
      action: AuditAction.SELFIE_VIEWED,
      metadata: { storageKey: verification.selfieStorageKey },
    });

    return { url: verification.selfieStorageKey };
  }

  /**
   * Approve or reject a verification.
   * @param verificationId - Verification UUID
   * @param dto - Admin decision (approve/reject with reason)
   * @param adminUserId - ID of the admin making the decision
   * @returns Updated verification record
   * @throws NotFoundException when verification does not exist
   * @throws BadRequestException when rejecting without reason
   * @throws ConflictException when verification is not in a reviewable state
   */
  async makeDecision(
    verificationId: string,
    dto: AdminDecisionDto,
    adminUserId: string,
  ): Promise<KycVerificationDetail> {
    const verification = await this.findVerificationOrFail(verificationId);
    this.assertReviewableState(verification);
    this.validateRejectionReason(dto);

    const targetStatus = this.resolveTargetStatus(dto.decision);

    await this.stateTransitionService.transition({
      targetStatus,
      context: {
        verification,
        reviewedBy: adminUserId,
        rejectionReason: dto.rejectionReason,
      },
    });

    await this.createDecisionAuditLog(
      verification,
      targetStatus,
      adminUserId,
      dto.rejectionReason,
    );

    await this.kycNotificationService.notifyStatusChange(
      verification.userId,
      targetStatus,
      dto.rejectionReason,
    );

    return this.getVerificationDetail(verificationId);
  }

  /** Find verification by ID or throw NotFoundException */
  private async findVerificationOrFail(
    verificationId: string,
  ): Promise<KycVerification> {
    const verification = await this.kycRepository.findOne({
      where: { id: verificationId },
    });

    if (!verification) {
      throw new NotFoundException('kyc.error.verification_not_found');
    }

    return verification;
  }

  /** Assert verification is in a reviewable state (PROCESSING or REJECTED) */
  private assertReviewableState(verification: KycVerification): void {
    const reviewableStatuses: KycStatus[] = [
      KycStatus.PROCESSING,
      KycStatus.REJECTED,
    ];

    if (!reviewableStatuses.includes(verification.status)) {
      throw new ConflictException('kyc.error.not_reviewable');
    }
  }

  /** Validate that rejection reason is present when rejecting */
  private validateRejectionReason(dto: AdminDecisionDto): void {
    if (dto.decision === AdminDecision.REJECT && !dto.rejectionReason) {
      throw new BadRequestException('kyc.error.rejection_reason_required');
    }
  }

  /** Map admin decision to target KYC status */
  private resolveTargetStatus(decision: AdminDecision): KycStatus {
    return decision === AdminDecision.APPROVE
      ? KycStatus.VERIFIED
      : KycStatus.REJECTED;
  }

  /** Create audit log entry for admin decision */
  private async createDecisionAuditLog(
    verification: KycVerification,
    newStatus: KycStatus,
    adminUserId: string,
    rejectionReason?: string,
  ): Promise<void> {
    const decision =
      newStatus === KycStatus.VERIFIED
        ? AuditAction.VERIFICATION_APPROVED
        : AuditAction.VERIFICATION_REJECTED;

    await this.kycAuditService.logAdminDecision({
      verificationId: verification.id,
      actorId: adminUserId,
      decision,
      oldStatus: verification.status,
      newStatus,
      metadata: {
        ocrConfidence: verification.ocrConfidence,
        faceSimilarityScore: verification.faceSimilarityScore,
        livenessScore: verification.livenessScore,
        ...(rejectionReason ? { rejectionReason } : {}),
      },
    });
  }
}

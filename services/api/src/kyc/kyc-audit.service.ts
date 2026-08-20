import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycAuditLog } from './entities/kyc-audit-log.entity';
import { KycStatus } from './kyc.types';

/**
 * All tracked audit actions for the KYC module.
 * Used across services/jobs for consistent action naming.
 */
export enum AuditAction {
  STATE_TRANSITION = 'STATE_TRANSITION',
  DOCUMENT_VIEWED = 'DOCUMENT_VIEWED',
  SELFIE_VIEWED = 'SELFIE_VIEWED',
  OCR_VIEWED = 'OCR_VIEWED',
  VERIFICATION_APPROVED = 'VERIFICATION_APPROVED',
  VERIFICATION_REJECTED = 'VERIFICATION_REJECTED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  SELFIE_DELETED = 'SELFIE_DELETED',
}

/** Parameters for logging a state transition */
export interface StateTransitionParams {
  readonly verificationId: string;
  readonly actorId: string | null;
  readonly oldStatus: KycStatus;
  readonly newStatus: KycStatus;
  readonly metadata?: Record<string, unknown>;
}

/** Parameters for logging admin data access (GDPR compliance) */
export interface DataAccessParams {
  readonly verificationId: string;
  readonly actorId: string;
  readonly action: AuditAction.DOCUMENT_VIEWED | AuditAction.SELFIE_VIEWED | AuditAction.OCR_VIEWED;
  readonly metadata?: Record<string, unknown>;
}

/** Parameters for logging admin decisions */
export interface AdminDecisionParams {
  readonly verificationId: string;
  readonly actorId: string;
  readonly decision: AuditAction.VERIFICATION_APPROVED | AuditAction.VERIFICATION_REJECTED;
  readonly oldStatus: KycStatus;
  readonly newStatus: KycStatus;
  readonly metadata?: Record<string, unknown>;
}

/** Parameters for logging image deletions */
export interface DeletionParams {
  readonly verificationId: string;
  readonly action: AuditAction.DOCUMENT_DELETED | AuditAction.SELFIE_DELETED;
  readonly metadata: Record<string, unknown>;
}

/**
 * Centralized KYC audit logging service.
 * Provides typed methods for all audit actions ensuring consistent
 * metadata structure, action naming, and GDPR compliance logging.
 */
@Injectable()
export class KycAuditService {
  constructor(
    @InjectRepository(KycAuditLog)
    private readonly auditLogRepository: Repository<KycAuditLog>,
  ) {}

  /**
   * Log a KYC state transition.
   * Used by upload flows, processing job, and retry logic.
   */
  async logStateTransition(params: StateTransitionParams): Promise<void> {
    const log = this.auditLogRepository.create({
      verificationId: params.verificationId,
      action: AuditAction.STATE_TRANSITION,
      actorId: params.actorId,
      oldStatus: params.oldStatus,
      newStatus: params.newStatus,
      metadata: params.metadata ?? null,
    });
    await this.auditLogRepository.save(log);
  }

  /**
   * Log admin data access for GDPR compliance.
   * Tracks when admins view document images, selfie images, or OCR results.
   */
  async logDataAccess(params: DataAccessParams): Promise<void> {
    const log = this.auditLogRepository.create({
      verificationId: params.verificationId,
      action: params.action,
      actorId: params.actorId,
      oldStatus: null,
      newStatus: null,
      metadata: params.metadata ?? null,
    });
    await this.auditLogRepository.save(log);
  }

  /**
   * Log an admin approve/reject decision.
   * Includes verification scores and rejection reason in metadata.
   */
  async logAdminDecision(params: AdminDecisionParams): Promise<void> {
    const log = this.auditLogRepository.create({
      verificationId: params.verificationId,
      action: params.decision,
      actorId: params.actorId,
      oldStatus: params.oldStatus,
      newStatus: params.newStatus,
      metadata: params.metadata ?? null,
    });
    await this.auditLogRepository.save(log);
  }

  /**
   * Log image deletion (auto or manual).
   * actorId is null for system-triggered deletions (cleanup job).
   */
  async logDeletion(params: DeletionParams): Promise<void> {
    const log = this.auditLogRepository.create({
      verificationId: params.verificationId,
      action: params.action,
      actorId: null,
      oldStatus: null,
      newStatus: null,
      metadata: params.metadata,
    });
    await this.auditLogRepository.save(log);
  }
}

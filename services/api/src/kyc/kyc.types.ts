/**
 * KYC verification type definitions.
 * Defines states, interfaces, and configuration for the KYC verification flow.
 */

/** All possible KYC verification statuses */
export enum KycStatus {
  NOT_STARTED = 'NOT_STARTED',
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  SELFIE_UPLOADED = 'SELFIE_UPLOADED',
  PROCESSING = 'PROCESSING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

/** Supported identity document types */
export enum DocumentType {
  PASSPORT = 'PASSPORT',
  NATIONAL_ID = 'NATIONAL_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
}

/** KYC verification record interface */
export interface KycVerificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: KycStatus;
  readonly attemptNumber: number;
  readonly documentType: DocumentType | null;
  readonly documentStorageKey: string | null;
  readonly selfieStorageKey: string | null;
  readonly extractedName: string | null;
  readonly extractedDocumentNumber: string | null;
  readonly extractedExpiryDate: Date | null;
  readonly extractedDocumentType: string | null;
  readonly ocrConfidence: number | null;
  readonly faceSimilarityScore: number | null;
  readonly livenessScore: number | null;
  readonly nameMatchScore: number | null;
  readonly processingAttempts: number;
  readonly lastProcessingError: string | null;
  readonly rejectionReason: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly documentUploadedAt: Date | null;
  readonly selfieUploadedAt: Date | null;
  readonly processingStartedAt: Date | null;
  readonly completedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Current KYC status response for the user */
export interface KycStatusResponse {
  readonly status: KycStatus;
  readonly attemptNumber: number;
  readonly rejectionReason: string | null;
  readonly completedAt: Date | null;
}

/** Admin queue item for pending review */
export interface KycQueueItem {
  readonly id: string;
  readonly userId: string;
  readonly status: KycStatus;
  readonly attemptNumber: number;
  readonly documentType: DocumentType | null;
  readonly createdAt: Date;
  readonly processingStartedAt: Date | null;
}

/** Admin detail view of a verification */
export interface KycVerificationDetail {
  readonly id: string;
  readonly userId: string;
  readonly status: KycStatus;
  readonly attemptNumber: number;
  readonly documentType: DocumentType | null;
  readonly extractedName: string | null;
  readonly extractedDocumentNumber: string | null;
  readonly extractedExpiryDate: Date | null;
  readonly ocrConfidence: number | null;
  readonly faceSimilarityScore: number | null;
  readonly livenessScore: number | null;
  readonly nameMatchScore: number | null;
  readonly rejectionReason: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** KYC processing thresholds loaded from environment */
export interface KycThresholds {
  readonly ocrConfidenceMin: number;
  readonly faceSimilarityMin: number;
  readonly livenessScoreMin: number;
  readonly nameMatchMin: number;
}

/** KYC configuration loaded from environment */
export interface KycConfig {
  readonly maxAttempts: number;
  readonly maxFileSize: number;
  readonly allowedMimeTypes: readonly string[];
  readonly imageRetentionDays: number;
  readonly processingMaxRetries: number;
  readonly processingBackoffMs: number;
  readonly thresholds: KycThresholds;
}

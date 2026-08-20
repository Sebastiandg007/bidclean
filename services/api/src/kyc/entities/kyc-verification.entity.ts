import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
  Check,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { KycStatus, DocumentType } from '../kyc.types';

/**
 * KYC verification entity.
 * Each record represents one verification attempt for a user.
 * Current status is derived from the latest attempt (highest attempt_number).
 */
@Entity('kyc_verifications')
@Unique('uq_kyc_user_attempt', ['userId', 'attemptNumber'])
@Check('chk_attempt_number', '"attempt_number" > 0')
@Index('idx_kyc_verifications_user', ['userId'])
@Index('idx_kyc_verifications_status', ['status'])
export class KycVerification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 30, default: KycStatus.NOT_STARTED })
  status!: KycStatus;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  attemptNumber!: number;

  @Column({ name: 'document_type', type: 'varchar', length: 30, nullable: true })
  documentType!: DocumentType | null;

  @Column({ name: 'document_storage_key', type: 'varchar', length: 512, nullable: true })
  documentStorageKey!: string | null;

  @Column({ name: 'selfie_storage_key', type: 'varchar', length: 512, nullable: true })
  selfieStorageKey!: string | null;

  @Column({ name: 'extracted_name', type: 'varchar', length: 255, nullable: true })
  extractedName!: string | null;

  @Column({ name: 'extracted_document_number', type: 'varchar', length: 100, nullable: true })
  extractedDocumentNumber!: string | null;

  @Column({ name: 'extracted_expiry_date', type: 'date', nullable: true })
  extractedExpiryDate!: Date | null;

  @Column({ name: 'extracted_document_type', type: 'varchar', length: 30, nullable: true })
  extractedDocumentType!: string | null;

  @Column({ name: 'ocr_confidence', type: 'numeric', precision: 5, scale: 4, nullable: true })
  ocrConfidence!: number | null;

  @Column({ name: 'face_similarity_score', type: 'numeric', precision: 5, scale: 4, nullable: true })
  faceSimilarityScore!: number | null;

  @Column({ name: 'liveness_score', type: 'numeric', precision: 5, scale: 4, nullable: true })
  livenessScore!: number | null;

  @Column({ name: 'name_match_score', type: 'numeric', precision: 5, scale: 4, nullable: true })
  nameMatchScore!: number | null;

  @Column({ name: 'processing_attempts', type: 'int', default: 0 })
  processingAttempts!: number;

  @Column({ name: 'last_processing_error', type: 'text', nullable: true })
  lastProcessingError!: string | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'document_uploaded_at', type: 'timestamptz', nullable: true })
  documentUploadedAt!: Date | null;

  @Column({ name: 'selfie_uploaded_at', type: 'timestamptz', nullable: true })
  selfieUploadedAt!: Date | null;

  @Column({ name: 'processing_started_at', type: 'timestamptz', nullable: true })
  processingStartedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer!: User | null;
}

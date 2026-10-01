import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Verification-session entity.
 *
 * Maps to `verification_sessions`, the durable 1:1 on-arrival identity-check record for a
 * `service_sessions` row. It holds the participants, the state machine, the derived
 * `{ decision, matchScore }`, the snapshotted `matchThreshold`, and retention/deletion bookkeeping.
 * It NEVER holds the video bytes (those live in MinIO) and has intentionally NO `deletedAt` — the
 * record is an immutable audit fact; only the video object is deleted by retention. `matchScore` is
 * INTERNAL and never exposed raw to the Host. `processingAttempt` is a monotonic stale-update guard.
 */
@Entity('verification_sessions')
@Unique('uq_verification_sessions_service_session', ['serviceSessionId'])
@Check(
  'chk_verification_sessions_state',
  `"state" IN ('PENDING_UPLOAD','UPLOADED','PROCESSING','MATCH','NO_MATCH','INCONCLUSIVE','FAILED','DISABLED','EXPIRED')`,
)
@Check(
  'chk_verification_sessions_decision',
  `"decision" IS NULL OR "decision" IN ('MATCH','NO_MATCH','INCONCLUSIVE')`,
)
@Check('chk_verification_sessions_reference_source', `"reference_source" IN ('KYC_SELFIE')`)
@Check(
  'chk_verification_sessions_failure_reason',
  `"failure_reason" IS NULL OR "failure_reason" IN ('NO_REFERENCE','VIDEO_UNAVAILABLE','AI_UNAVAILABLE','AI_TIMEOUT','MAX_ATTEMPTS')`,
)
@Check('chk_verification_sessions_threshold_range', `"match_threshold" > 0 AND "match_threshold" <= 1`)
@Check(
  'chk_verification_sessions_score_range',
  `"match_score" IS NULL OR ("match_score" >= 0 AND "match_score" <= 1)`,
)
@Index('idx_verification_sessions_offer', ['offerId'])
@Index('idx_verification_sessions_cleaner', ['cleanerId'])
@Index('idx_verification_sessions_host', ['hostId'])
export class VerificationSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The arrived service session this verification belongs to (FK CASCADE; unique 1:1) */
  @Column({ name: 'service_session_id', type: 'uuid' })
  serviceSessionId!: string;

  /** Denormalized parent offer (FK CASCADE) */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** The arriving Cleaner (FK SET NULL on user deletion) */
  @Column({ name: 'cleaner_id', type: 'uuid', nullable: true })
  cleanerId!: string | null;

  /** The Host (FK SET NULL on user deletion) */
  @Column({ name: 'host_id', type: 'uuid', nullable: true })
  hostId!: string | null;

  /** Opaque MinIO key of the arrival video; null until UPLOADED / after retention delete */
  @Column({ name: 'object_key', type: 'varchar', length: 512, nullable: true })
  objectKey!: string | null;

  /** Lifecycle state (VARCHAR + CHECK, never a PG enum) */
  @Column({ type: 'varchar', length: 20, default: 'PENDING_UPLOAD' })
  state!: string;

  /** Derived comparison decision; set with the terminal comparison transition */
  @Column({ type: 'varchar', length: 20, nullable: true })
  decision!: string | null;

  /** Derived similarity 0..1 — INTERNAL, never exposed raw to the Host */
  @Column({ name: 'match_score', type: 'numeric', precision: 5, scale: 4, nullable: true })
  matchScore!: string | null;

  /** Snapshot of the config threshold at creation; the decision uses THIS, not live config */
  @Column({ name: 'match_threshold', type: 'numeric', precision: 5, scale: 4 })
  matchThreshold!: string;

  /** Which verified face was compared against */
  @Column({ name: 'reference_source', type: 'varchar', length: 20, default: 'KYC_SELFIE' })
  referenceSource!: string;

  /** Monotonic async-comparison retry counter; stale-update guard */
  @Column({ name: 'processing_attempt', type: 'integer', default: 0 })
  processingAttempt!: number;

  /** Non-sensitive failure reason; never a stack trace, never biometric data */
  @Column({ name: 'failure_reason', type: 'varchar', length: 40, nullable: true })
  failureReason!: string | null;

  /** The retention clock starts here */
  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  uploadedAt!: Date | null;

  /** Set on the terminal comparison transition */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  /** Set when the object is hard-deleted by retention/tombstone */
  @Column({ name: 'video_deleted_at', type: 'timestamptz', nullable: true })
  videoDeletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

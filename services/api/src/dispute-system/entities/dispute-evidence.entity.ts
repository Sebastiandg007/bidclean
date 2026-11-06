import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Dispute evidence entity (`dispute_evidence`).
 *
 * A typed reference to a durable fact (never a byte copy) or a Host/Cleaner submission. Visual kinds
 * (`HOST_PHOTO`, `CHECKLIST_PHOTO_REF`) resolve to a short-lived pre-signed URL on read; structured
 * kinds to gated data. Only `HOST_PHOTO` carries an `object_key` (the tombstone trigger frees it on
 * delete/cascade). No `deleted_at` — evidence metadata is audit.
 */
@Entity('dispute_evidence')
@Check(
  'chk_dispute_evidence_kind',
  `"kind" IN ('HOST_PHOTO', 'HOST_REASON', 'CHECKLIST_REF', 'CHECKLIST_PHOTO_REF', 'VERIFICATION_REF', 'ARRIVAL_REF', 'NOTE')`,
)
@Index('idx_dispute_evidence_dispute', ['disputeId'])
@Index('idx_dispute_evidence_submitted_by', ['submittedBy'])
export class DisputeEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dispute_id', type: 'uuid' })
  disputeId!: string;

  @Column({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedBy!: string | null;

  @Column({ type: 'varchar', length: 25 })
  kind!: string;

  /** MinIO key for `HOST_PHOTO` only; unique when set (partial unique in the migration). */
  @Column({ name: 'object_key', type: 'varchar', length: 512, nullable: true })
  objectKey!: string | null;

  /** Stable upstream reference id for structured/photo-ref kinds (never a byte copy). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  ref!: string | null;

  @Column({ name: 'text_value', type: 'text', nullable: true })
  textValue!: string | null;

  @Column({ name: 'size_bytes', type: 'integer', nullable: true })
  sizeBytes!: number | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 64, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'object_deleted_at', type: 'timestamptz', nullable: true })
  objectDeletedAt!: Date | null;

  /** For `HOST_PHOTO` — the retention clock starts here. */
  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  uploadedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

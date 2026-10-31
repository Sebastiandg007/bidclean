import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Dispute upload-grant entity (`dispute_upload_grants`).
 *
 * A single-use grant binding a server-generated `object_key` to a dispute + the issuing participant
 * (an object key is a GRANT, never a credential). Persisted BEFORE the pre-signed PUT is minted, and
 * consumed on finalize. The `object_key` is the PK.
 */
@Entity('dispute_upload_grants')
@Check('chk_dispute_grants_status', `"status" IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED')`)
@Index('idx_dispute_grants_dispute', ['disputeId'])
@Index('idx_dispute_grants_status_expires', ['status', 'expiresAt'])
export class DisputeUploadGrant {
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  @Column({ name: 'dispute_id', type: 'uuid' })
  disputeId!: string;

  @Column({ name: 'issued_to_user_id', type: 'uuid', nullable: true })
  issuedToUserId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ISSUED' })
  status!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_evidence_id', type: 'uuid', nullable: true })
  consumedEvidenceId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Dispute object-deletion tombstone entity (`dispute_object_deletions`).
 *
 * A `BEFORE DELETE` trigger copies a freed `HOST_PHOTO` `object_key` here (in the same transaction
 * as the delete/cascade), so the cleanup worker can remove the MinIO object even after its owning
 * row is gone. The `object_key` PK dedups double-tombstoning.
 */
@Entity('dispute_object_deletions')
@Check('chk_dispute_object_deletions_reason', `"reason" IN ('ROW_DELETED', 'CASCADE')`)
@Check('chk_dispute_object_deletions_status', `"status" IN ('PENDING', 'DONE')`)
@Index('idx_dispute_object_deletions_status_created', ['status', 'createdAt'])
export class DisputeObjectDeletion {
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  @Column({ type: 'varchar', length: 30, default: 'CASCADE' })
  reason!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}

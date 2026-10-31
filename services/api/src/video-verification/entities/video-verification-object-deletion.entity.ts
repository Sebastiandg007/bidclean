import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Video-verification object-deletion tombstone entity.
 *
 * Maps to `video_verification_object_deletions`. A `BEFORE DELETE` trigger on
 * `verification_sessions` copies the freed `objectKey` here IN THE SAME TRANSACTION as the delete
 * (direct or CASCADE), so the tombstone-drain worker can remove the MinIO object even after the
 * owning row is gone. `objectKey` is the PK so a double-tombstone is a no-op.
 */
@Entity('video_verification_object_deletions')
@Check('chk_video_verification_object_deletions_reason', `"reason" IN ('ROW_DELETED', 'CASCADE')`)
@Check('chk_video_verification_object_deletions_status', `"status" IN ('PENDING', 'DONE')`)
@Index('idx_video_verification_object_deletions_status_created', ['status', 'createdAt'])
export class VideoVerificationObjectDeletion {
  /** The freed object key (primary key; PK dedups double-tombstoning) */
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Why the tombstone was written: ROW_DELETED | CASCADE */
  @Column({ type: 'varchar', length: 30, default: 'ROW_DELETED' })
  reason!: string;

  /** Tombstone lifecycle: PENDING | DONE */
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When the MinIO removeObject succeeded */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}

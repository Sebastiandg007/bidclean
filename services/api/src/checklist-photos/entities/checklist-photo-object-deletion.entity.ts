import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Checklist photo object-deletion tombstone entity (`checklist_photo_object_deletions`).
 *
 * When a `checklist_task_photos` row is deleted (direct or via CASCADE up
 * task/run/session/offer), a `BEFORE DELETE` trigger copies the freed `objectKey` here IN THE SAME
 * TRANSACTION — captured atomically before it is lost. The cleanup worker deletes the MinIO object
 * idempotently and marks the row `DONE`. Object deletion is always eventual. The `object_key` PK
 * dedups double-tombstoning.
 */
@Entity('checklist_photo_object_deletions')
@Check('chk_checklist_object_deletions_reason', `"reason" IN ('ROW_DELETED', 'CASCADE')`)
@Check('chk_checklist_object_deletions_status', `"status" IN ('PENDING', 'DONE')`)
@Index('idx_checklist_object_deletions_status_created', ['status', 'createdAt'])
export class ChecklistPhotoObjectDeletion {
  /** The freed MinIO object key copied from the deleted checklist_task_photos row. */
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Why the key was tombstoned: ROW_DELETED | CASCADE (app-validated). */
  @Column({ type: 'varchar', length: 30, default: 'CASCADE' })
  reason!: string;

  /** Lifecycle: PENDING (awaiting MinIO removal) | DONE (object removed). */
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When the MinIO object removal succeeded; null while PENDING. */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}

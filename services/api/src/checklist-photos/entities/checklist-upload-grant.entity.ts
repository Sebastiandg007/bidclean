import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Checklist upload-grant entity (`checklist_upload_grants`).
 *
 * A server-generated, unguessable `objectKey` (the primary key) is bound to one run/task and the
 * issuing Cleaner, single-use, with a short expiry — an object key is a GRANT, never a credential.
 * While `ISSUED` and unexpired it reserves a per-task photo slot (concurrency-safe cap). `run_id`/
 * `task_id` CASCADE; `issuedToUserId`/`consumedPhotoId` are SET NULL (deletion coherence).
 */
@Entity('checklist_upload_grants')
@Check('chk_checklist_grants_status', `"status" IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED')`)
@Index('idx_checklist_grants_run', ['runId'])
@Index('idx_checklist_grants_task', ['taskId'])
@Index('idx_checklist_grants_status_expires', ['status', 'expiresAt'])
export class ChecklistUploadGrant {
  /** Server-generated, unguessable MinIO key this grant authorizes (single object). */
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Run the grant is scoped to (FK CASCADE). */
  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  /** Task the grant is scoped to (FK CASCADE). */
  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  /** Issuing Cleaner (FK SET NULL — retain the grant record if the user is deleted/anonymized). */
  @Column({ name: 'issued_to_user_id', type: 'uuid', nullable: true })
  issuedToUserId!: string | null;

  /** Lifecycle: ISSUED (usable, reserves a slot) | CONSUMED | EXPIRED | CANCELLED. */
  @Column({ type: 'varchar', length: 20, default: 'ISSUED' })
  status!: string;

  /** Short-lived expiry after which the grant (and its orphan object) is cleanup-eligible. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** The durable photo that consumed this grant (at most one); FK SET NULL. */
  @Column({ name: 'consumed_photo_id', type: 'uuid', nullable: true })
  consumedPhotoId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

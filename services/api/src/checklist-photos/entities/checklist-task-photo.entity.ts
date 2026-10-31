import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Checklist task photo entity (`checklist_task_photos`).
 *
 * Evidence metadata only — never the bytes. The bytes live in MinIO; `object_deleted_at` is set
 * once they are hard-deleted by retention/tombstone. `task_id`/`run_id` CASCADE (run-scoped
 * cleanup). No `deleted_at`: the metadata row is an audit fact. `UNIQUE object_key`.
 */
@Entity('checklist_task_photos')
@Unique('uq_checklist_task_photos_object', ['objectKey'])
@Check('chk_checklist_task_photos_kind', `"kind" IN ('BEFORE', 'AFTER', 'GENERAL')`)
@Index('idx_checklist_task_photos_task', ['taskId'])
@Index('idx_checklist_task_photos_run', ['runId'])
export class ChecklistTaskPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The task this evidence is attached to (FK CASCADE). */
  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  /** Denormalized run id for run-scoped cleanup (FK CASCADE). */
  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  /** The photo object in MinIO (server-generated, unguessable, UNIQUE). */
  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Evidence kind: BEFORE | AFTER | GENERAL (app-validated). */
  @Column({ type: 'varchar', length: 20, default: 'GENERAL' })
  kind!: string;

  /** Server-observed authoritative size in bytes. */
  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes!: number;

  /** Server-observed allowed image content-type. */
  @Column({ name: 'mime_type', type: 'varchar', length: 64 })
  mimeType!: string;

  /** Server-probed width (px); null when not probed. */
  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  /** Server-probed height (px); null when not probed. */
  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  /** Set when the bytes are hard-deleted by retention/tombstone (metadata retained). */
  @Column({ name: 'object_deleted_at', type: 'timestamptz', nullable: true })
  objectDeletedAt!: Date | null;

  /** The retention clock starts here. */
  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

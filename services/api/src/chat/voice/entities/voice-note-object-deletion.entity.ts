import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * Voice-note object-deletion tombstone entity.
 *
 * Maps to `voice_note_object_deletions`. When a `chat_voice_notes` row is deleted for any reason
 * (direct delete or CASCADE up message → conversation → thread → offer), a `BEFORE DELETE`
 * trigger copies the freed `objectKey` here IN THE SAME TRANSACTION as the delete — so the key is
 * captured atomically before it is lost and can be drained later. The cleanup worker deletes the
 * MinIO object idempotently and marks the row `DONE`. Object deletion is always eventual: the
 * trigger only records the key inside the DB transaction; the actual MinIO removal happens later.
 */
@Entity('voice_note_object_deletions')
@Check('chk_object_deletions_status', `"status" IN ('PENDING', 'DONE')`)
@Index('idx_object_deletions_status_created', ['status', 'createdAt'])
export class VoiceNoteObjectDeletion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The freed MinIO object key copied from the deleted chat_voice_notes row */
  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Lifecycle: PENDING (awaiting MinIO removal) | DONE (object removed) */
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  /** When the row was tombstoned (inside the deleting transaction) */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When the MinIO object removal succeeded; null while PENDING */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

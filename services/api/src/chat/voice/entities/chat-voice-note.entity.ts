import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';

/**
 * Chat voice-note entity.
 *
 * Maps to `chat_voice_notes`, the 1:1 audio-metadata row for a `chat_messages` row with
 * `type = 'VOICE'`. It holds the opaque MinIO `objectKey` (UNIQUE) and the SERVER-OBSERVED audio
 * metadata (duration/size/mime — the authoritative probe values, not the client-declared ones),
 * plus the derived, best-effort transcript fields. The transcript is never authoritative and is
 * never logged verbatim. `transcriptAttempt` is a monotonic per-note counter guarding against a
 * slower, older attempt overwriting a newer result. Audio is immutable — there is intentionally
 * no `deletedAt`; only the transcript fields mutate. The FK to `chat_messages` is UNIQUE and
 * ON DELETE CASCADE.
 */
@Entity('chat_voice_notes')
@Unique('uq_chat_voice_notes_message', ['messageId'])
@Unique('uq_chat_voice_notes_object', ['objectKey'])
@Check(
  'chk_chat_voice_notes_transcript_status',
  `"transcript_status" IN ('PENDING', 'READY', 'FAILED', 'DISABLED')`,
)
@Index('idx_chat_voice_notes_status_updated', ['transcriptStatus', 'updatedAt'])
export class ChatVoiceNote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The VOICE message this metadata belongs to (FK CASCADE; unique 1:1) */
  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  /** Opaque, unguessable MinIO key in the chat-voice-notes bucket */
  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Server-observed clip duration in milliseconds (authoritative) */
  @Column({ name: 'duration_ms', type: 'integer' })
  durationMs!: number;

  /** Server-observed object size in bytes (authoritative) */
  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes!: number;

  /** Server-observed audio content type (authoritative) */
  @Column({ name: 'mime_type', type: 'varchar', length: 64 })
  mimeType!: string;

  /** Optional small amplitude array for the player's visual (not the audio) */
  @Column({ type: 'jsonb', nullable: true })
  waveform!: number[] | null;

  /** Derived best-effort transcript text (never authoritative, never logged verbatim) */
  @Column({ type: 'text', nullable: true })
  transcript!: string | null;

  /** Transcript lifecycle: PENDING | READY | FAILED | DISABLED */
  @Column({ name: 'transcript_status', type: 'varchar', length: 20, default: 'PENDING' })
  transcriptStatus!: string;

  /** Detected transcript language (BCP-47); null until READY */
  @Column({ name: 'transcript_lang', type: 'varchar', length: 35, nullable: true })
  transcriptLang!: string | null;

  /** Monotonic per-note attempt counter; stale-update guard */
  @Column({ name: 'transcript_attempt', type: 'integer', default: 0 })
  transcriptAttempt!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

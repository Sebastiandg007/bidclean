import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * Voice-note upload-grant entity.
 *
 * Maps to `voice_note_upload_grants`. A server-generated, unguessable `objectKey` (the primary
 * key) is bound to one conversation and the issuing user, single-use, with a short expiry —
 * turning an object key into a GRANT, never a credential. Sending a voice note requires a valid,
 * unexpired, unconsumed grant issued to the caller for that conversation. `conversationId`
 * CASCADEs (a grant is meaningless without its conversation); `issuedToUserId` and
 * `consumedMessageId` are FK SET NULL so deleting a user or a message never destroys the grant
 * record (deletion coherence).
 */
@Entity('voice_note_upload_grants')
@Check('chk_voice_grant_status', `"status" IN ('ISSUED', 'CONSUMED')`)
@Index('idx_upload_grants_conversation', ['conversationId'])
@Index('idx_upload_grants_status_expires', ['status', 'expiresAt'])
export class VoiceNoteUploadGrant {
  /** Server-generated, unguessable MinIO key this grant authorizes (single object) */
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** Conversation the grant is scoped to (FK CASCADE) */
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  /** Issuing user (FK SET NULL — retain the grant record if the user is deleted/anonymized) */
  @Column({ name: 'issued_to_user_id', type: 'uuid', nullable: true })
  issuedToUserId!: string | null;

  /** Lifecycle: ISSUED (usable) | CONSUMED (spent on a durable message) */
  @Column({ type: 'varchar', length: 20, default: 'ISSUED' })
  status!: string;

  /** Short-lived expiry after which the grant (and its orphan object) is cleanup-eligible */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** The durable message that consumed this grant (at most one); FK SET NULL */
  @Column({ name: 'consumed_message_id', type: 'uuid', nullable: true })
  consumedMessageId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

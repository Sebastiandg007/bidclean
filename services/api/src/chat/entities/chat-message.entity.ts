import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';

/**
 * Chat message entity.
 *
 * Maps to `chat_messages`. An immutable text message in a conversation. `sequenceNumber` is
 * unique and strictly increasing per conversation (gaps allowed) and establishes total order
 * independent of timestamps. `clientMessageId` is unique per conversation for idempotent send
 * and optimistic reconciliation. Messages are immutable in v1 — there is intentionally no
 * `deletedAt`/edit. `senderId` is nullable (FK SET NULL) so history survives a
 * deleted/anonymized participant. `type` is a discriminator kept for future attachment types
 * but only `TEXT` is valid in v1.
 */
@Entity('chat_messages')
@Unique('uq_chat_message_sequence', ['conversationId', 'sequenceNumber'])
@Unique('uq_chat_message_client_id', ['conversationId', 'clientMessageId'])
@Check('chk_chat_message_type', `"type" IN ('TEXT')`)
@Index('idx_chat_messages_conversation_seq', ['conversationId', 'sequenceNumber'])
@Index('idx_chat_messages_sender', ['senderId'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Conversation this message belongs to (FK CASCADE) */
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  /** Author (FK SET NULL — retain the message if the sender is deleted/anonymized) */
  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId!: string | null;

  /** Message type discriminator; only `TEXT` in v1 */
  @Column({ type: 'varchar', length: 20, default: 'TEXT' })
  type!: string;

  /** Message body (validated for length before persistence; never logged verbatim) */
  @Column({ type: 'text' })
  body!: string;

  /** Unique, strictly-increasing per-conversation order key (gaps allowed) */
  @Column({ name: 'sequence_number', type: 'integer' })
  sequenceNumber!: number;

  /** Client-generated id for idempotent send / optimistic reconciliation */
  @Column({ name: 'client_message_id', type: 'varchar', length: 64 })
  clientMessageId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

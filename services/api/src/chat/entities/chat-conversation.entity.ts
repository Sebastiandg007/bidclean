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
 * Chat conversation entity.
 *
 * Maps to `chat_conversations`. A conversation is 1:1 with a matched `negotiation_thread`
 * (UNIQUE `thread_id`) and copies its two participants (`hostId`, `cleanerId`) and `offerId`.
 * `messageSeq` is the row-locked monotonic counter that sources each message's `sequenceNumber`.
 * A conversation is `OPEN` only while its match is valid; it becomes `CLOSED` on match
 * invalidation (offer terminal or thread closed) and then rejects new messages while history
 * stays readable. Participants are nullable so deleting/anonymizing a user never destroys the
 * shared conversation (FK `ON DELETE SET NULL`).
 */
@Entity('chat_conversations')
@Unique('uq_chat_conversation_thread', ['threadId'])
@Check('chk_chat_conversation_status', `"status" IN ('OPEN', 'CLOSED')`)
@Index('idx_chat_conversations_host', ['hostId'])
@Index('idx_chat_conversations_cleaner', ['cleanerId'])
@Index('idx_chat_conversations_offer', ['offerId'])
@Index('idx_chat_conversations_last_message', ['lastMessageAt'])
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Matched negotiation thread this conversation belongs to (FK CASCADE; unique) */
  @Column({ name: 'thread_id', type: 'uuid' })
  threadId!: string;

  /** Offer the matched thread negotiated (FK CASCADE) */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Host participant (FK SET NULL — retain conversation if the user is deleted) */
  @Column({ name: 'host_id', type: 'uuid', nullable: true })
  hostId!: string | null;

  /** Cleaner participant (FK SET NULL — retain conversation if the user is deleted) */
  @Column({ name: 'cleaner_id', type: 'uuid', nullable: true })
  cleanerId!: string | null;

  /** Lifecycle: OPEN while the match is valid, CLOSED once invalidated */
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: string;

  /** Row-locked monotonic counter sourcing `chat_messages.sequence_number` */
  @Column({ name: 'message_seq', type: 'integer', default: 0 })
  messageSeq!: number;

  /** Timestamp of the latest message; drives inbox ordering (updated atomically with inserts) */
  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

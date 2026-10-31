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
 * VoIP call entity (Spec 15).
 *
 * Maps to `voip_calls`, the durable record THAT a live voice/video call happened between the two
 * participants of a `chat_conversations` row. It holds the opaque LiveKit `roomName` (UNIQUE,
 * never reused) and the call's lifecycle facts — never media. Terminal statuses are immutable
 * audit facts, so there is intentionally no `deletedAt`; only lifecycle fields mutate while
 * non-terminal.
 *
 * FK deletion policy (mirrors the migration): `conversationId`/`offerId` CASCADE (never a
 * user-cascade); `initiatorId`/`calleeId` are nullable (ON DELETE SET NULL) so history survives a
 * deleted/anonymized participant. The partial indexes (one-active-per-conversation, initiator-
 * scoped idempotency, ring/stale sweeps) are created in the migration since TypeORM cannot express
 * partial `WHERE` clauses; the non-partial constraints are declared here for parity.
 */
@Entity('voip_calls')
@Unique('uq_voip_calls_room', ['roomName'])
@Check(
  'chk_voip_calls_media_kind',
  `"media_kind" IN ('AUDIO', 'VIDEO')`,
)
@Check(
  'chk_voip_calls_status',
  `"status" IN ('RINGING', 'ONGOING', 'ENDED', 'MISSED', 'DECLINED', 'CANCELED', 'FAILED')`,
)
@Check(
  'chk_voip_calls_end_reason',
  `"end_reason" IS NULL OR "end_reason" IN ('HANGUP', 'DECLINED', 'CANCELED', 'TIMEOUT_NO_ANSWER', 'TIMEOUT', 'CONVERSATION_CLOSED', 'ERROR')`,
)
@Index('idx_voip_calls_conversation', ['conversationId', 'initiatedAt'])
export class VoipCall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The conversation this call belongs to (FK CASCADE); participants + OPEN-lifecycle come from it. */
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  /** Denormalized offer id (FK CASCADE) for offer-terminal lifecycle coherence. */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Initiator user id; nullable so a deleted/anonymized user does not destroy call history. */
  @Column({ name: 'initiator_id', type: 'uuid', nullable: true })
  initiatorId!: string | null;

  /** Callee user id; nullable so a deleted/anonymized user does not destroy call history. */
  @Column({ name: 'callee_id', type: 'uuid', nullable: true })
  calleeId!: string | null;

  /** AUDIO (default) | VIDEO (optional, capability-gated). */
  @Column({ name: 'media_kind', type: 'varchar', length: 10, default: 'AUDIO' })
  mediaKind!: string;

  /** Opaque LiveKit room id; UNIQUE, never reused across calls, never a credential. */
  @Column({ name: 'room_name', type: 'varchar', length: 128 })
  roomName!: string;

  /** Lifecycle: RINGING|ONGOING (non-terminal) or the terminal set (immutable). */
  @Column({ type: 'varchar', length: 12, default: 'RINGING' })
  status!: string;

  /** End reason paired with a terminal status; null while non-terminal. */
  @Column({ name: 'end_reason', type: 'varchar', length: 24, nullable: true })
  endReason!: string | null;

  /** Initiator-generated id; makes initiate idempotent (scoped with initiatorId in the migration). */
  @Column({ name: 'client_call_id', type: 'varchar', length: 64 })
  clientCallId!: string;

  @Column({ name: 'initiated_at', type: 'timestamptz', default: () => 'NOW()' })
  initiatedAt!: Date;

  /** Set on RINGING -> ONGOING. */
  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt!: Date | null;

  /** Set on any terminal transition. */
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  /** Updated by the signed LiveKit webhook (server-authoritative liveness); drives the stale sweep. */
  @Column({ name: 'last_media_activity_at', type: 'timestamptz', nullable: true })
  lastMediaActivityAt!: Date | null;

  /** Derived on end: ended_at - answered_at; 0/NULL when never answered. */
  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

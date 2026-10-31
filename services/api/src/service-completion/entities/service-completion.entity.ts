import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Service completion entity (`service_completions`).
 *
 * The durable completion DECISION bound 1:1 to a service session (`UNIQUE service_session_id`) — it
 * records confirm/auto-release/dispute + the snapshotted auto-release deadline, never the money
 * ledger. Parent session/offer CASCADE; user FKs SET NULL (Spec 13 invariant). No `deleted_at`: a
 * terminal completion is an immutable audit fact.
 */
@Entity('service_completions')
@Unique('uq_service_completions_session', ['serviceSessionId'])
@Check(
  'chk_service_completions_state',
  `"state" IN ('AWAITING_CONFIRMATION', 'CONFIRMED', 'AUTO_RELEASED', 'DISPUTED')`,
)
@Check(
  'chk_service_completions_trigger',
  `"released_trigger" IS NULL OR "released_trigger" IN ('HOST_CONFIRMED', 'AUTO_RELEASE')`,
)
@Check(
  'chk_service_completions_trigger_coherence',
  `("released_trigger" IS NULL) = ("state" NOT IN ('CONFIRMED', 'AUTO_RELEASED'))`,
)
@Index('idx_service_completions_offer', ['offerId'])
@Index('idx_service_completions_payment', ['paymentId'])
@Index('idx_service_completions_host', ['hostId'])
@Index('idx_service_completions_cleaner', ['cleanerId'])
export class ServiceCompletion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The session this completion hangs off of (FK CASCADE, UNIQUE — idempotency backstop). */
  @Column({ name: 'service_session_id', type: 'uuid' })
  serviceSessionId!: string;

  /** Denormalized offer id (FK CASCADE). */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Reference to the escrow payment (Spec 9, its own bounded context; no FK cascade from payments). */
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  /** The Host participant (FK SET NULL — history retained on user deletion). */
  @Column({ name: 'host_id', type: 'uuid', nullable: true })
  hostId!: string | null;

  /** The Cleaner participant (FK SET NULL — history retained on user deletion). */
  @Column({ name: 'cleaner_id', type: 'uuid', nullable: true })
  cleanerId!: string | null;

  /** Pre-release lifecycle (app-validated). */
  @Column({ type: 'varchar', length: 30, default: 'AWAITING_CONFIRMATION' })
  state!: string;

  /** The AUTHORITATIVE finish time carried on `checklist_completed` (never consume time). */
  @Column({ name: 'checklist_completed_at', type: 'timestamptz' })
  checklistCompletedAt!: Date;

  /** `= checklist_completed_at + window`; snapshotted at creation, server-swept. */
  @Column({ name: 'auto_release_deadline', type: 'timestamptz' })
  autoReleaseDeadline!: Date;

  /** Set on `→ CONFIRMED`. */
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  /** Set with `CONFIRMED`/`AUTO_RELEASED` (app-validated). */
  @Column({ name: 'released_trigger', type: 'varchar', length: 20, nullable: true })
  releasedTrigger!: string | null;

  /** Pre-release dispute link (routed to Spec 21). */
  @Column({ name: 'dispute_id', type: 'uuid', nullable: true })
  disputeId!: string | null;

  /** A dispute opened AFTER release fired (distinct concept; never overloads `DISPUTED`). */
  @Column({ name: 'post_release_dispute_id', type: 'uuid', nullable: true })
  postReleaseDisputeId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

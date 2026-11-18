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
 * Release intent entity (`release_intents`).
 *
 * A durable financial COMMAND persisted in the SAME transaction as a release-bearing decision
 * (`CONFIRMED`/`AUTO_RELEASED`) and drained out-of-band by the worker into Spec 9's single-winner
 * release. `service_completion_id` is `ON DELETE SET NULL` (NOT cascade): the intent carries its own
 * `payment_id` + `reason`, so it SURVIVES completion deletion and the release path is never lost.
 * `uq_release_intents_completion` guarantees at most one intent per completion while it exists.
 */
@Entity('release_intents')
@Unique('uq_release_intents_completion', ['serviceCompletionId'])
@Check('chk_release_intents_reason', `"reason" IN ('HOST_CONFIRMED', 'AUTO_RELEASE')`)
@Check(
  'chk_release_intents_status',
  `"status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE')`,
)
@Index('idx_release_intents_completion', ['serviceCompletionId'])
@Index('idx_release_intents_payment', ['paymentId'])
export class ReleaseIntent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The originating completion (FK SET NULL — the intent outlives the completion). */
  @Column({ name: 'service_completion_id', type: 'uuid', nullable: true })
  serviceCompletionId!: string | null;

  /** The escrow payment to release (self-sufficient with `reason`). */
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  /** The release reason passed to Spec 9 (app-validated subset of ReleaseReason). */
  @Column({ type: 'varchar', length: 20 })
  reason!: string;

  /** Execution lifecycle (app-validated). ACCEPTED = command accepted, not funds settled. */
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  /** Incremented on `FAILED_RETRYABLE`. */
  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  /** Set when a worker claims the intent (`→ DISPATCHED`). */
  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  /** Claim lease expiry; a DISPATCHED intent past this is an orphaned dispatch, re-claimable. */
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  /** Sanitized transient-failure reason (no secrets/PII). */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

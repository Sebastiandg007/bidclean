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
 * Checklist run entity (`checklist_runs`).
 *
 * The durable run bound 1:1 to a service session (`UNIQUE service_session_id`) — a
 * temporally-exact snapshot of the property checklist + policies at IN_PROGRESS. The parent
 * session/offer CASCADE; `property_id` is SET NULL (deletion coherence). No `deleted_at`: a
 * terminal run is an immutable audit fact; only photo bytes are ever removed.
 */
@Entity('checklist_runs')
@Unique('uq_checklist_runs_service_session', ['serviceSessionId'])
@Check('chk_checklist_runs_state', `"state" IN ('ACTIVE', 'COMPLETED', 'ABANDONED')`)
@Check(
  'chk_checklist_runs_completed_range',
  `"completed_tasks" >= 0 AND "completed_tasks" <= "total_tasks"`,
)
@Index('idx_checklist_runs_offer', ['offerId'])
@Index('idx_checklist_runs_property', ['propertyId'])
export class ChecklistRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The in-progress session this run hangs off of (FK CASCADE, UNIQUE — idempotency backstop). */
  @Column({ name: 'service_session_id', type: 'uuid' })
  serviceSessionId!: string;

  /** Denormalized offer id (FK CASCADE). */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Property the checklist was snapshotted from (FK SET NULL — snapshot lives on the tasks). */
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId!: string | null;

  /** Snapshot task count (may be 0). */
  @Column({ name: 'total_tasks', type: 'integer', default: 0 })
  totalTasks!: number;

  /** Derived count kept in sync with COUNT(is_done=true) under the run lock. */
  @Column({ name: 'completed_tasks', type: 'integer', default: 0 })
  completedTasks!: number;

  /** Task-level photo-required policy frozen at creation. */
  @Column({ name: 'photo_required_policy_snapshot', type: 'jsonb' })
  photoRequiredPolicySnapshot!: unknown;

  /** Run-level completion rule frozen at creation. */
  @Column({ name: 'completion_precondition_snapshot', type: 'jsonb' })
  completionPreconditionSnapshot!: unknown;

  /** Max photos per task frozen at creation. */
  @Column({ name: 'max_photos_per_task_snapshot', type: 'integer' })
  maxPhotosPerTaskSnapshot!: number;

  /** Lifecycle: ACTIVE | COMPLETED | ABANDONED (app-validated). */
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  state!: string;

  /** Set on ACTIVE → COMPLETED. */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  /** Set on ACTIVE → ABANDONED (OFFER_TERMINAL/SESSION_TERMINAL). */
  @Column({ name: 'abandoned_reason', type: 'varchar', length: 30, nullable: true })
  abandonedReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

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
 * Service rating entity (`service_ratings`).
 *
 * A mutual Host<->Cleaner star rating captured on `CONFIRMED`/`AUTO_RELEASED`, one per side
 * (`UNIQUE (service_completion_id, role)`). Captured, never gating: a release never waits on a
 * rating. CASCADE with the completion (audit/reputation data); user FKs SET NULL. No `deleted_at`.
 */
@Entity('service_ratings')
@Unique('uq_service_ratings_completion_role', ['serviceCompletionId', 'role'])
@Check('chk_service_ratings_role', `"role" IN ('HOST_RATES_CLEANER', 'CLEANER_RATES_HOST')`)
@Check('chk_service_ratings_stars', `"stars" >= 1 AND "stars" <= 5`)
@Index('idx_service_ratings_completion', ['serviceCompletionId'])
@Index('idx_service_ratings_rater', ['raterId'])
@Index('idx_service_ratings_ratee', ['rateeId'])
export class ServiceRating {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The completion this rating belongs to (FK CASCADE). */
  @Column({ name: 'service_completion_id', type: 'uuid' })
  serviceCompletionId!: string;

  /** The participant who rated (FK SET NULL — history retained). */
  @Column({ name: 'rater_id', type: 'uuid', nullable: true })
  raterId!: string | null;

  /** The participant who was rated (FK SET NULL — history retained). */
  @Column({ name: 'ratee_id', type: 'uuid', nullable: true })
  rateeId!: string | null;

  /** Which side rated the other (app-validated). */
  @Column({ type: 'varchar', length: 20 })
  role!: string;

  /** 1..5 (DDL floor/ceiling; the service layer enforces the configured bounds within that). */
  @Column({ type: 'smallint' })
  stars!: number;

  /** Optional user comment — validated/escaped, never executed. */
  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

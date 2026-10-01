import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Checklist task entity (`checklist_tasks`).
 *
 * A per-task snapshot of one property checklist item at start, plus its done/undone completion
 * state. `run_id` CASCADEs; `UNIQUE (run_id, position)` preserves the snapshot order.
 */
@Entity('checklist_tasks')
@Unique('uq_checklist_tasks_run_position', ['runId', 'position'])
@Index('idx_checklist_tasks_run', ['runId'])
@Index('idx_checklist_tasks_run_done', ['runId', 'isDone'])
export class ChecklistTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The owning run (FK CASCADE). */
  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  /** Order within the run (snapshot position). */
  @Column({ type: 'integer' })
  position!: number;

  /** Snapshot of the property item text at start. */
  @Column({ name: 'task_text', type: 'text' })
  taskText!: string;

  /** Whether the task is marked done. */
  @Column({ name: 'is_done', type: 'boolean', default: false })
  isDone!: boolean;

  /** Set when `is_done` becomes true; cleared when undone. */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

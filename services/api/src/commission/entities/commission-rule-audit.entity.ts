import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { RuleAuditAction } from '../commission.types';

/**
 * Commission rule audit entity — maps to the append-only `commission_rule_audit` table.
 *
 * One immutable row per rule mutation (CREATE|UPDATE|ACTIVATE|DEACTIVATE) capturing the
 * actor, timestamp, and before/after values (sanitized scope + rate bps + window + flags).
 * The FK to commission_rules uses ON DELETE RESTRICT so history cannot be cascaded away.
 */
@Entity('commission_rule_audit')
@Check('chk_commission_audit_action', `"action" IN ('CREATE','UPDATE','ACTIVATE','DEACTIVATE')`)
@Index('idx_commission_rule_audit_rule', ['ruleId', 'createdAt'])
@Index('idx_commission_rule_audit_actor', ['actorId'])
export class CommissionRuleAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The rule this audit row describes (FK RESTRICT) */
  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId!: string;

  /** The mutation performed */
  @Column({ type: 'varchar', length: 12 })
  action!: RuleAuditAction;

  /** The acting user (FK users SET NULL), null if system-initiated */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  /** Previous sanitized values (null on CREATE) */
  @Column({ name: 'old_values', type: 'jsonb', nullable: true })
  oldValues!: Record<string, unknown> | null;

  /** Resulting sanitized values */
  @Column({ name: 'new_values', type: 'jsonb' })
  newValues!: Record<string, unknown>;

  /** Optional free-text reason, persisted verbatim */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

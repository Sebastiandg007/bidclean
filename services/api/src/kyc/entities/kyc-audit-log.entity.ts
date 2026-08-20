import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { KycVerification } from './kyc-verification.entity';
import { KycStatus } from '../kyc.types';

/**
 * KYC audit log entity.
 * Records every state transition, admin decision, and data access event
 * for GDPR compliance and full audit traceability.
 */
@Entity('kyc_audit_logs')
@Index('idx_kyc_audit_logs_verification', ['verificationId'])
@Index('idx_kyc_audit_logs_actor', ['actorId'])
export class KycAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Reference to the verification attempt this log belongs to */
  @Column({ name: 'verification_id', type: 'uuid' })
  verificationId!: string;

  /** The action performed (e.g., DOCUMENT_VIEWED, VERIFICATION_APPROVED) */
  @Column({ type: 'varchar', length: 50 })
  action!: string;

  /** The user who performed the action (null for system-triggered events) */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  /** Previous KYC status before the action (null if not a state transition) */
  @Column({ name: 'old_status', type: 'varchar', length: 30, nullable: true })
  oldStatus!: KycStatus | null;

  /** New KYC status after the action (null if not a state transition) */
  @Column({ name: 'new_status', type: 'varchar', length: 30, nullable: true })
  newStatus!: KycStatus | null;

  /** Additional context (e.g., rejection reason, IP address, scores) */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => KycVerification, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'verification_id' })
  verification!: KycVerification;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;
}

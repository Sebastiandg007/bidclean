import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('biometric_credentials')
@Unique(['userId', 'deviceId'])
export class BiometricCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ name: 'device_id', type: 'varchar', length: 255 })
  deviceId!: string;

  @Column({ name: 'public_key', type: 'text' })
  publicKey!: string;

  @Column({ name: 'credential_type', type: 'varchar', length: 50 })
  credentialType!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @ManyToOne(() => User, (user) => user.biometricCredentials, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('biometric_challenges')
export class BiometricChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'device_id', type: 'varchar', length: 255 })
  deviceId!: string;

  @Column({ type: 'varchar', length: 255 })
  nonce!: string;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'boolean', default: false })
  used!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AuthSession } from './auth-session.entity';
import { BiometricCredential } from './biometric-credential.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'keycloak_id', type: 'varchar', length: 255, unique: true })
  keycloakId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName!: string;

  @Column({ type: 'char', length: 2 })
  country!: string;

  @Column({ type: 'varchar', length: 35, default: 'en' })
  language!: string;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified!: boolean;

  /** Assigned roles (e.g., ['host'], ['cleaner'], or ['host', 'cleaner']) */
  @Column({ name: 'roles', type: 'varchar', array: true, default: '{}' })
  roles!: string[];

  /** Currently active role for UI navigation (nullable until role selection) */
  @Column({ name: 'active_role', type: 'varchar', length: 20, nullable: true })
  activeRole!: string | null;

  /** Host onboarding status: NOT_STARTED | IN_PROGRESS | COMPLETED */
  @Column({ name: 'onboarding_status_host', type: 'varchar', length: 20, default: 'NOT_STARTED' })
  onboardingStatusHost!: string;

  /** Cleaner onboarding status: NOT_STARTED | IN_PROGRESS | COMPLETED */
  @Column({ name: 'onboarding_status_cleaner', type: 'varchar', length: 20, default: 'NOT_STARTED' })
  onboardingStatusCleaner!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => AuthSession, (session) => session.user)
  sessions!: AuthSession[];

  @OneToMany(() => BiometricCredential, (credential) => credential.user)
  biometricCredentials!: BiometricCredential[];
}

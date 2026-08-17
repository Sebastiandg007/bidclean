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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => AuthSession, (session) => session.user)
  sessions!: AuthSession[];

  @OneToMany(() => BiometricCredential, (credential) => credential.user)
  biometricCredentials!: BiometricCredential[];
}

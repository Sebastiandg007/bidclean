import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Video-verification upload-grant entity.
 *
 * Maps to `video_verification_upload_grants`. An object key is a GRANT, not a credential: it binds
 * a server-generated `objectKey` (PK) to a service session + the issuing Cleaner, single-use with
 * an expiry. `issuedToUserId`/`consumedVerificationId` are ON DELETE SET NULL (deletion coherence).
 */
@Entity('video_verification_upload_grants')
@Check('chk_video_verification_grant_status', `"status" IN ('ISSUED', 'CONSUMED')`)
@Index('idx_video_verification_grants_session', ['serviceSessionId'])
@Index('idx_video_verification_grants_status_expires', ['status', 'expiresAt'])
export class VideoVerificationUploadGrant {
  /** Server-generated, unguessable object key (primary key) */
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  /** The service session the grant is bound to (FK CASCADE) */
  @Column({ name: 'service_session_id', type: 'uuid' })
  serviceSessionId!: string;

  /** The issuing Cleaner; nullable so a deleted user does not destroy the grant record */
  @Column({ name: 'issued_to_user_id', type: 'uuid', nullable: true })
  issuedToUserId!: string | null;

  /** Grant lifecycle: ISSUED | CONSUMED */
  @Column({ type: 'varchar', length: 20, default: 'ISSUED' })
  status!: string;

  /** Short-lived expiry */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** The durable verification that consumed the grant (at most one) */
  @Column({ name: 'consumed_verification_id', type: 'uuid', nullable: true })
  consumedVerificationId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

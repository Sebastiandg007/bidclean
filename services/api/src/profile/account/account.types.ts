/**
 * Account management types.
 */

/** Response containing a Keycloak Account Console URL for email change */
export interface EmailChangeUrlResponse {
  readonly url: string;
}

/** User deletion status values */
export type DeletionStatus = 'DELETION_PENDING' | 'DELETED';

/** Deletion job step names for audit logging */
export type DeletionStep =
  | 'CANCEL_SUBSCRIPTIONS'
  | 'DELETE_KEYCLOAK'
  | 'DELETE_MINIO'
  | 'ANONYMIZE_PII'
  | 'MARK_DELETED';

/** Deletion job audit entry */
export interface DeletionAuditEntry {
  readonly step: DeletionStep;
  readonly status: 'STARTED' | 'COMPLETED' | 'FAILED';
  readonly timestamp: Date;
  readonly error?: string;
}

/**
 * Session metadata types.
 *
 * Used by SessionService for device tracking and application-level logout.
 */

/** Input for creating a new session record. */
export interface CreateSessionInput {
  readonly userId: string;
  readonly keycloakSessionId: string;
  readonly deviceId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

/**
 * Public/safe representation of a session.
 * Returned when listing active sessions for the user (no internal IDs exposed).
 */
export interface SessionInfo {
  readonly id: string;
  readonly deviceId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly lastActiveAt: Date;
  readonly createdAt: Date;
}

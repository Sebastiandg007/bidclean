/**
 * Decoded JWT payload from Keycloak-issued tokens.
 * Maps standard OIDC claims to typed fields.
 */
export interface DecodedKeycloakToken {
  /** Keycloak user ID (subject) */
  readonly sub: string;
  /** User email address */
  readonly email: string;
  /** Whether email has been verified in Keycloak */
  readonly email_verified: boolean;
  /** User's full name */
  readonly name?: string;
  /** Given (first) name */
  readonly given_name?: string;
  /** Family (last) name */
  readonly family_name?: string;
  /** Preferred username in Keycloak */
  readonly preferred_username?: string;
  /** Token issuer URL (e.g., http://localhost:8080/realms/bidclean) */
  readonly iss: string;
  /** Audience — Keycloak client ID */
  readonly aud: string | string[];
  /** Issued at (Unix timestamp) */
  readonly iat: number;
  /** Expiration time (Unix timestamp) */
  readonly exp: number;
  /** Keycloak session ID */
  readonly session_state?: string;
  /** Authorized party — client that requested the token */
  readonly azp?: string;
}

/**
 * Minimal user payload attached to request.user after JWT validation.
 * Keeps only what downstream handlers need.
 */
export interface JwtUserPayload {
  readonly keycloakId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly sessionState?: string;
}

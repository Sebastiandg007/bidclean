/**
 * Authentication-related type definitions.
 */

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly tokenType: string;
}

export interface AuthUser {
  readonly userId: string;
  readonly keycloakId: string;
  readonly email: string;
  readonly sessionId: string;
}

export interface BiometricChallenge {
  readonly challenge: string;
  readonly expiresAt: string;
}

export interface RegistrationResult {
  readonly userId: string;
  readonly email: string;
  readonly message: string;
}

export interface LoginUrlResponse {
  readonly url: string;
  readonly codeVerifier: string;
  readonly state: string;
}

export interface CallbackResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly tokenType: string;
  readonly sessionId: string;
  readonly userId: string;
}

export interface HandleCallbackOptions {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly deviceId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface LogoutResponse {
  readonly message: string;
}

/**
 * Public user profile returned by GET /auth/me.
 * Excludes sensitive fields (keycloakId, sessions, biometricCredentials).
 */
export interface UserProfileResponse {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly country: string;
  readonly language: string;
  readonly isEmailVerified: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Biometric credential and challenge types.
 */

export interface BiometricCredential {
  readonly id: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly publicKey: string;
  readonly credentialType: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface BiometricChallengeRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly used: boolean;
  readonly createdAt: string;
}

/**
 * useBiometricLogin — Hook for biometric authentication login flow.
 *
 * Orchestrates the full biometric login sequence:
 * 1. Request challenge (nonce) from server
 * 2. Prompt user for biometric authentication (fingerprint/Face ID)
 * 3. Sign challenge with device private key
 * 4. Verify signature with server → receive tokens
 * 5. Store tokens and update auth state
 *
 * Exposes loading, error, and availability state for UI consumption.
 */

import { useCallback, useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';

import { apiClient } from '../../services/api.service';
import { useAuthStore } from '../../stores/auth.store';
import type { AuthTokens, AuthUser } from '../../stores/auth.store';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Error codes for biometric login failures */
export type BiometricLoginErrorCode =
  | 'challenge_expired'
  | 'signature_invalid'
  | 'biometric_cancelled'
  | 'biometric_unavailable'
  | 'network_error'
  | 'unknown';

/** Structured biometric login error */
export interface BiometricLoginError {
  code: BiometricLoginErrorCode;
  message: string;
}

/** Response from POST /auth/biometric/challenge */
interface ChallengeResponse {
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

/** Response from POST /auth/biometric/verify */
interface VerifyResponse {
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  user: {
    id: string;
    keycloak_id: string;
    email: string;
    full_name: string;
    country: string;
    language: string;
    is_email_verified: boolean;
  };
}

/** Return type of the useBiometricLogin hook */
export interface UseBiometricLoginReturn {
  loginWithBiometric: () => Promise<boolean>;
  isLoading: boolean;
  error: BiometricLoginError | null;
  isBiometricAvailable: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Requests a biometric challenge nonce from the server.
 *
 * @param deviceId - Unique device identifier registered during biometric setup
 */
async function requestChallenge(deviceId: string): Promise<ChallengeResponse> {
  const response = await apiClient.post<ChallengeResponse>(
    '/auth/biometric/challenge',
    { device_id: deviceId },
  );

  return response.data;
}

/**
 * Prompts the user for biometric authentication (fingerprint/Face ID).
 * Returns true if authentication succeeds, throws on cancel or unavailable.
 */
async function promptBiometric(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Authenticate to log in',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });

  if (!result.success) {
    const isCancelled =
      result.error === 'user_cancel' || result.error === 'system_cancel';

    const error: BiometricLoginError = {
      code: isCancelled ? 'biometric_cancelled' : 'biometric_unavailable',
      message: isCancelled
        ? 'Biometric authentication was cancelled'
        : 'Biometric authentication failed',
    };

    throw error;
  }

  return true;
}

/**
 * Signs a challenge nonce with the device private key.
 *
 * TODO(BID-BIOMETRIC): Production implementation will retrieve the actual private
 * key from Secure Enclave (iOS) / Keystore (Android) and perform a real asymmetric
 * signature. This placeholder uses SHA-256 digest to simulate the signing flow.
 */
async function signChallenge(nonce: string): Promise<string> {
  const signature = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    nonce,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );

  return signature;
}

/**
 * Sends the signed challenge to the server for verification.
 * On success, returns tokens and user data for session establishment.
 */
async function verifyWithApi(options: {
  deviceId: string;
  signature: string;
  challengeId: string;
}): Promise<VerifyResponse> {
  const response = await apiClient.post<VerifyResponse>(
    '/auth/biometric/verify',
    {
      device_id: options.deviceId,
      signature: options.signature,
      challenge_id: options.challengeId,
    },
  );

  return response.data;
}

/**
 * Maps an HTTP error status to a BiometricLoginError.
 */
function mapApiError(error: unknown): BiometricLoginError {
  const status = (error as { response?: { status?: number } })?.response?.status;

  if (status === 410) {
    return {
      code: 'challenge_expired',
      message: 'Challenge expired. Please try again.',
    };
  }

  if (status === 401) {
    return {
      code: 'signature_invalid',
      message: 'Signature verification failed. Please try again.',
    };
  }

  const isNetworkError = (error as { code?: string })?.code === 'ERR_NETWORK';

  if (isNetworkError) {
    return { code: 'network_error', message: 'Network error. Check your connection.' };
  }

  return { code: 'unknown', message: 'Something went wrong. Please try again.' };
}

/**
 * Transforms the verify API response into AuthTokens and AuthUser for the store.
 */
function toAuthData(response: VerifyResponse): { tokens: AuthTokens; user: AuthUser } {
  const { tokens, user } = response;

  return {
    tokens: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    },
    user: {
      id: user.id,
      keycloakId: user.keycloak_id,
      email: user.email,
      fullName: user.full_name,
      country: user.country,
      language: user.language,
      isEmailVerified: user.is_email_verified,
    },
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Custom hook that orchestrates the biometric login flow.
 *
 * @returns Object with loginWithBiometric action, loading/error state, and availability flag
 *
 * @example
 * ```tsx
 * const { loginWithBiometric, isLoading, error, isBiometricAvailable } = useBiometricLogin();
 *
 * if (isBiometricAvailable) {
 *   const success = await loginWithBiometric();
 * }
 * ```
 */
export function useBiometricLogin(): UseBiometricLoginReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<BiometricLoginError | null>(null);
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);

  const login = useAuthStore((state) => state.login);
  const biometricDeviceId = useAuthStore((state) => state.biometric.deviceId);

  // ─── Check biometric availability on mount ───────────────────────────────

  useEffect(() => {
    async function checkAvailability(): Promise<void> {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsBiometricAvailable(compatible && enrolled);
    }

    checkAvailability();
  }, []);

  // ─── Main login flow ─────────────────────────────────────────────────────

  const loginWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!biometricDeviceId) {
      setError({
        code: 'biometric_unavailable',
        message: 'Biometric is not registered on this device.',
      });
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Request challenge nonce from server
      const challenge = await requestChallenge(biometricDeviceId);

      // Step 2: Prompt user for biometric authentication
      await promptBiometric();

      // Step 3: Sign the challenge nonce with private key
      const signature = await signChallenge(challenge.nonce);

      // Step 4: Verify signature with the server
      const verifyResponse = await verifyWithApi({
        deviceId: biometricDeviceId,
        signature,
        challengeId: challenge.challengeId,
      });

      // Step 5: Store tokens and update auth state
      const { tokens, user } = toAuthData(verifyResponse);
      login(tokens, user);

      return true;
    } catch (err) {
      // BiometricLoginError thrown by promptBiometric
      if ((err as BiometricLoginError).code) {
        setError(err as BiometricLoginError);
      } else {
        setError(mapApiError(err));
      }

      return false;
    } finally {
      setIsLoading(false);
    }
  }, [biometricDeviceId, login]);

  return { loginWithBiometric, isLoading, error, isBiometricAvailable };
}

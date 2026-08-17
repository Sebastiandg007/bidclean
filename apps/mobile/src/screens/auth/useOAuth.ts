/**
 * useOAuth — Hook for Keycloak OAuth2 Authorization Code + PKCE flow.
 *
 * Uses expo-auth-session to open the system browser (not WebView)
 * for secure authentication. Handles login and registration flows,
 * PKCE code challenge generation, and token exchange via BidClean API.
 */

import { useState, useCallback } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import type {
  CallbackResponse,
  OAuthError,
  OAuthErrorCode,
  UseOAuthReturn,
} from './auth.types';
import {
  AUTHORIZATION_ENDPOINT,
  TOKEN_ENDPOINT,
  KEYCLOAK_CLIENT_ID,
  OAUTH_SCOPES,
  APP_SCHEME,
  API_CALLBACK_URL,
  KC_ACTION_REGISTER,
} from './oauth.config';

// ─── Constants ───────────────────────────────────────────────────────────────

/** PKCE code verifier length in bytes (generates 43-128 character verifier) */
const CODE_VERIFIER_BYTES = 32;

/** Ensure browser session is dismissed on iOS */
WebBrowser.maybeCompleteAuthSession();

// ─── Discovery Document ──────────────────────────────────────────────────────

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: AUTHORIZATION_ENDPOINT,
  tokenEndpoint: TOKEN_ENDPOINT,
};

// ─── Redirect URI ────────────────────────────────────────────────────────────

const redirectUri = AuthSession.makeRedirectUri({
  scheme: APP_SCHEME,
  path: 'auth/callback',
});

// ─── Helper Functions ────────────────────────────────────────────────────────

function createOAuthError(code: OAuthErrorCode, message: string, details?: unknown): OAuthError {
  return { code, message, details };
}

/** Generate a cryptographically random code verifier for PKCE */
async function generateCodeVerifier(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(CODE_VERIFIER_BYTES);
  return base64UrlEncode(randomBytes);
}

/** Generate SHA-256 code challenge from the verifier */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return base64ToBase64Url(digest);
}

/** Convert Uint8Array to URL-safe base64 string */
function base64UrlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64ToBase64Url(base64);
}

/** Convert standard base64 to URL-safe base64 (no padding) */
function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Exchange authorization code for tokens via BidClean API */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<CallbackResponse> {
  const response = await fetch(API_CALLBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw createOAuthError(
      'token_exchange_failed',
      `Token exchange failed with status ${response.status}`,
      errorBody,
    );
  }

  return response.json() as Promise<CallbackResponse>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/** Hook for managing OAuth2 Authorization Code + PKCE flow with Keycloak */
export function useOAuth(): UseOAuthReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<OAuthError | null>(null);

  const startAuthFlow = useCallback(async (isRegistration: boolean): Promise<CallbackResponse | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const codeVerifier = await generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      const extraParams: Record<string, string> = {
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      };

      if (isRegistration) {
        extraParams.kc_action = KC_ACTION_REGISTER;
      }

      const authRequest = new AuthSession.AuthRequest({
        clientId: KEYCLOAK_CLIENT_ID,
        scopes: OAUTH_SCOPES,
        redirectUri,
        usePKCE: false, // We handle PKCE manually for full control
        extraParams,
        responseType: AuthSession.ResponseType.Code,
      });

      const result = await authRequest.promptAsync(discovery);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setError(createOAuthError('user_cancelled', 'Authentication was cancelled by the user'));
        return null;
      }

      if (result.type !== 'success') {
        setError(createOAuthError(
          'unknown',
          `Authentication failed with result type: ${result.type}`,
          result,
        ));
        return null;
      }

      const { code } = result.params;

      if (!code) {
        setError(createOAuthError('invalid_code', 'No authorization code received from Keycloak'));
        return null;
      }

      const callbackResponse = await exchangeCodeForTokens(code, codeVerifier);
      return callbackResponse;
    } catch (err) {
      if (isOAuthError(err)) {
        setError(err);
      } else {
        setError(createOAuthError(
          'network_error',
          err instanceof Error ? err.message : 'An unexpected error occurred during authentication',
          err,
        ));
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startLogin = useCallback(async (): Promise<CallbackResponse | null> => {
    return startAuthFlow(false);
  }, [startAuthFlow]);

  const startRegistration = useCallback(async (): Promise<CallbackResponse | null> => {
    return startAuthFlow(true);
  }, [startAuthFlow]);

  return { startLogin, startRegistration, isLoading, error };
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

function isOAuthError(value: unknown): value is OAuthError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value
  );
}

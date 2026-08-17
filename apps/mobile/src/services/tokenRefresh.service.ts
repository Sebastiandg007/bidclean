/**
 * Token Refresh Service — Direct Keycloak token refresh for the mobile app.
 *
 * Uses a plain fetch call (NOT the apiClient) to avoid circular dependencies,
 * since the apiClient's 401 interceptor triggers refreshTokens().
 *
 * Keycloak handles rotation and revocation natively — BidClean never mints tokens.
 */

import {
  TOKEN_ENDPOINT,
  KEYCLOAK_CLIENT_ID,
} from '../screens/auth/oauth.config';
import type { AuthTokens } from '../stores/auth.store';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of the Keycloak token endpoint response */
interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  scope: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GRANT_TYPE_REFRESH = 'refresh_token';
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded';

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Refreshes the access token directly with Keycloak's token endpoint.
 *
 * @param refreshToken - The current refresh token stored on device
 * @returns New auth tokens with computed expiration timestamp
 * @throws Error if the refresh request fails (caller should force logout)
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<AuthTokens> {
  const body = new URLSearchParams({
    grant_type: GRANT_TYPE_REFRESH,
    refresh_token: refreshToken,
    client_id: KEYCLOAK_CLIENT_ID,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': CONTENT_TYPE_FORM },
    body: body.toString(),
  });

  if (!response.ok) {
    const status = response.status;
    throw new Error(
      `Token refresh failed: Keycloak responded with ${status}`,
    );
  }

  const keycloakResponse: KeycloakTokenResponse = await response.json();

  return mapToAuthTokens(keycloakResponse);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Maps the Keycloak response shape to our internal AuthTokens interface */
function mapToAuthTokens(response: KeycloakTokenResponse): AuthTokens {
  const expiresAt = Date.now() + response.expires_in * 1000;

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt,
  };
}

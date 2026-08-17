/**
 * OAuth configuration for Keycloak Authorization Code + PKCE flow.
 *
 * All endpoints and identifiers for the BidClean Keycloak realm.
 * Values are configurable via constants — swap for env vars in production builds.
 */

// ─── Keycloak Configuration ─────────────────────────────────────────────────

/** Keycloak realm name */
export const KEYCLOAK_REALM = 'bidclean';

/** Keycloak auth domain (without protocol) */
export const KEYCLOAK_DOMAIN = 'auth.bidclean.tech';

/** Keycloak base URL */
export const KEYCLOAK_BASE_URL = `https://${KEYCLOAK_DOMAIN}`;

/** OAuth2 client ID registered in Keycloak for the mobile app */
export const KEYCLOAK_CLIENT_ID = 'bidclean-mobile';

// ─── BidClean API ────────────────────────────────────────────────────────────

/** BidClean API base URL */
export const API_BASE_URL = 'https://api.bidclean.tech';

/** Endpoint to exchange authorization code for tokens */
export const API_CALLBACK_URL = `${API_BASE_URL}/auth/callback`;

// ─── OAuth2 Endpoints (Keycloak OIDC Discovery) ─────────────────────────────

const REALM_URL = `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}`;

/** Keycloak authorization endpoint */
export const AUTHORIZATION_ENDPOINT = `${REALM_URL}/protocol/openid-connect/auth`;

/** Keycloak token endpoint */
export const TOKEN_ENDPOINT = `${REALM_URL}/protocol/openid-connect/token`;

/** Keycloak end session endpoint */
export const END_SESSION_ENDPOINT = `${REALM_URL}/protocol/openid-connect/logout`;

// ─── OAuth2 Scopes ───────────────────────────────────────────────────────────

/** Default scopes requested during authorization */
export const OAUTH_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

// ─── Redirect Configuration ──────────────────────────────────────────────────

/** Expo app scheme used for deep linking callbacks */
export const APP_SCHEME = 'bidclean';

// ─── Keycloak Actions ────────────────────────────────────────────────────────

/** Keycloak action hint for registration flow */
export const KC_ACTION_REGISTER = 'register';

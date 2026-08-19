/**
 * Secure Storage Service — Encrypted token and user persistence via expo-secure-store.
 *
 * Provides async read/write/clear operations for auth tokens and user data.
 * Uses the device Secure Enclave (iOS) / Keystore (Android) for encryption.
 * All operations are gracefully handled — read failures return null, write failures log and continue.
 */

import * as SecureStore from 'expo-secure-store';

// ─── Types (local to avoid circular deps with auth.store) ────────────────────

export interface SecureAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

export interface SecureAuthUser {
  id: string;
  keycloakId: string;
  email: string;
  fullName: string;
  country: string;
  language: string;
  isEmailVerified: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SECURE_STORE_ACCESS_TOKEN = 'bidclean_access_token';
const SECURE_STORE_REFRESH_TOKEN = 'bidclean_refresh_token';
const SECURE_STORE_EXPIRES_AT = 'bidclean_expires_at';
const SECURE_STORE_USER = 'bidclean_user';
const SECURE_STORE_ROLES = 'bidclean_roles';
const SECURE_STORE_ACTIVE_ROLE = 'bidclean_active_role';

// ─── Token Operations ────────────────────────────────────────────────────────

/**
 * Persists auth tokens to SecureStore.
 * Each token field is stored as a separate key for atomic access.
 */
export async function storeTokens(tokens: SecureAuthTokens): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(SECURE_STORE_ACCESS_TOKEN, tokens.accessToken),
      SecureStore.setItemAsync(SECURE_STORE_REFRESH_TOKEN, tokens.refreshToken),
      SecureStore.setItemAsync(SECURE_STORE_EXPIRES_AT, String(tokens.expiresAt)),
    ]);
  } catch (error) {
    console.error('[SecureStorage] Failed to store tokens:', error);
  }
}

/**
 * Retrieves auth tokens from SecureStore.
 * Returns null if any required field is missing or read fails.
 */
export async function getTokens(): Promise<SecureAuthTokens | null> {
  try {
    const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
      SecureStore.getItemAsync(SECURE_STORE_ACCESS_TOKEN),
      SecureStore.getItemAsync(SECURE_STORE_REFRESH_TOKEN),
      SecureStore.getItemAsync(SECURE_STORE_EXPIRES_AT),
    ]);

    if (!accessToken || !refreshToken || !expiresAtRaw) {
      return null;
    }

    const expiresAt = Number(expiresAtRaw);

    if (Number.isNaN(expiresAt)) {
      return null;
    }

    return { accessToken, refreshToken, expiresAt };
  } catch (error) {
    console.error('[SecureStorage] Failed to read tokens:', error);
    return null;
  }
}

/**
 * Removes all token entries from SecureStore.
 */
export async function clearTokens(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_STORE_ACCESS_TOKEN),
      SecureStore.deleteItemAsync(SECURE_STORE_REFRESH_TOKEN),
      SecureStore.deleteItemAsync(SECURE_STORE_EXPIRES_AT),
    ]);
  } catch (error) {
    console.error('[SecureStorage] Failed to clear tokens:', error);
  }
}

// ─── User Operations ─────────────────────────────────────────────────────────

/**
 * Persists user data as JSON to SecureStore.
 */
export async function storeUser(user: SecureAuthUser): Promise<void> {
  try {
    const serialized = JSON.stringify(user);
    await SecureStore.setItemAsync(SECURE_STORE_USER, serialized);
  } catch (error) {
    console.error('[SecureStorage] Failed to store user:', error);
  }
}

/**
 * Retrieves user data from SecureStore.
 * Returns null if not found or parse fails.
 */
export async function getUser(): Promise<SecureAuthUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_STORE_USER);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as SecureAuthUser;
  } catch (error) {
    console.error('[SecureStorage] Failed to read user:', error);
    return null;
  }
}

/**
 * Removes user data from SecureStore.
 */
export async function clearUser(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_STORE_USER);
  } catch (error) {
    console.error('[SecureStorage] Failed to clear user:', error);
  }
}

// ─── Role Operations ─────────────────────────────────────────────────────────

/**
 * Persists the user's assigned roles array as JSON to SecureStore.
 */
export async function storeRoles(roles: string[]): Promise<void> {
  try {
    const serialized = JSON.stringify(roles);
    await SecureStore.setItemAsync(SECURE_STORE_ROLES, serialized);
  } catch (error) {
    console.error('[SecureStorage] Failed to store roles:', error);
  }
}

/**
 * Retrieves the user's assigned roles array from SecureStore.
 * Returns null if not found or parse fails.
 */
export async function getRoles(): Promise<string[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_STORE_ROLES);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as string[];
  } catch (error) {
    console.error('[SecureStorage] Failed to read roles:', error);
    return null;
  }
}

/**
 * Persists the user's active role to SecureStore.
 */
export async function storeActiveRole(role: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_STORE_ACTIVE_ROLE, role);
  } catch (error) {
    console.error('[SecureStorage] Failed to store active role:', error);
  }
}

/**
 * Retrieves the user's active role from SecureStore.
 * Returns null if not found or read fails.
 */
export async function getActiveRole(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_STORE_ACTIVE_ROLE);
  } catch (error) {
    console.error('[SecureStorage] Failed to read active role:', error);
    return null;
  }
}

/**
 * Removes all role-related data from SecureStore.
 */
export async function clearRoles(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_STORE_ROLES),
      SecureStore.deleteItemAsync(SECURE_STORE_ACTIVE_ROLE),
    ]);
  } catch (error) {
    console.error('[SecureStorage] Failed to clear roles:', error);
  }
}

// ─── Bulk Operations ─────────────────────────────────────────────────────────

/**
 * Clears all auth-related data from SecureStore (tokens + user + roles).
 */
export async function clearAll(): Promise<void> {
  await Promise.all([clearTokens(), clearUser(), clearRoles()]);
}

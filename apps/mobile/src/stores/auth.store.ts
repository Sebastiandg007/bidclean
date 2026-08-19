/**
 * Auth Store — Zustand store for authentication and role state.
 *
 * Manages user data, tokens, session metadata, biometric state, and user roles.
 * Tokens are persisted via SecureStore (implemented in Task 34).
 * Token refresh uses Keycloak token endpoint directly (implemented in Task 33).
 * Role state (activeRole, roles) is managed here for unified auth/role lifecycle.
 */

import { create } from 'zustand';
import { refreshAccessToken } from '../services/tokenRefresh.service';
import * as secureStorage from '../services/secureStorage.service';
import type { UserRole } from '../screens/roles/roles.types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Buffer in milliseconds before token is considered expired (30 seconds) */
const TOKEN_EXPIRY_BUFFER_MS = 30_000;

/** API endpoint for persisting active role to backend */
const ACTIVE_ROLE_ENDPOINT = '/users/me/active-role';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  keycloakId: string;
  email: string;
  fullName: string;
  country: string;
  language: string;
  isEmailVerified: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

export interface AuthSession {
  deviceId: string;
  keycloakSessionId: string;
}

export interface BiometricState {
  isEnabled: boolean;
  isRegistered: boolean;
  deviceId: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  tokens: AuthTokens | null;
  session: AuthSession | null;
  biometric: BiometricState;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** The currently active role determining navigation */
  activeRole: UserRole | null;
  /** All roles assigned to this user */
  roles: UserRole[];
}

export interface AuthActions {
  login: (tokens: AuthTokens, user: AuthUser, roles?: UserRole[], activeRole?: UserRole | null) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshTokens: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  setBiometricRegistered: (registered: boolean) => void;
  setSession: (session: AuthSession) => void;
  hydrate: () => Promise<void>;
  reset: () => void;
  isTokenExpired: () => boolean;
  /** Switch active role instantly. Validates role is in roles array first. */
  switchRole: (role: UserRole) => void;
  /** Add a new role to the roles array (if not already present) */
  addRole: (role: UserRole) => void;
  /** Set roles from backend response */
  setRoles: (roles: UserRole[], activeRole: UserRole | null) => void;
}

export type AuthStore = AuthState & AuthActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: AuthState = {
  user: null,
  tokens: null,
  session: null,
  biometric: {
    isEnabled: false,
    isRegistered: false,
    deviceId: null,
  },
  isAuthenticated: false,
  isLoading: false,
  activeRole: null,
  roles: [],
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>((set, get) => ({
  ...initialState,

  login: (
    tokens: AuthTokens,
    user: AuthUser,
    roles?: UserRole[],
    activeRole?: UserRole | null,
  ) => {
    set({
      tokens,
      user,
      isAuthenticated: true,
      isLoading: false,
      ...(roles !== undefined && { roles }),
      ...(activeRole !== undefined && { activeRole }),
    });

    // Persist tokens and user to SecureStore (fire-and-forget)
    secureStorage.storeTokens(tokens);
    secureStorage.storeUser(user);

    // Persist roles to SecureStore if provided (fire-and-forget)
    if (roles !== undefined) {
      secureStorage.storeRoles(roles);
    }

    if (activeRole !== undefined && activeRole !== null) {
      secureStorage.storeActiveRole(activeRole);
    }
  },

  logout: async () => {
    set({ isLoading: true });

    try {
      // TODO(Task-32): Call API logout endpoint via api.service
      // await apiClient.post('/auth/logout');
    } finally {
      get().reset();
    }
  },

  logoutAll: async () => {
    set({ isLoading: true });

    try {
      // TODO(Task-32): Call API logout-all endpoint via api.service
      // await apiClient.post('/auth/logout-all');
    } finally {
      get().reset();
    }
  },

  refreshTokens: async () => {
    const { tokens } = get();

    if (!tokens?.refreshToken) {
      get().reset();
      return;
    }

    try {
      const newTokens = await refreshAccessToken(tokens.refreshToken);
      set({ tokens: newTokens, isAuthenticated: true });
      // Persist refreshed tokens to SecureStore (fire-and-forget)
      secureStorage.storeTokens(newTokens);
    } catch {
      // Refresh failed — session is invalid, force logout
      get().reset();
    }
  },

  setUser: (user: AuthUser) => {
    set({ user });
  },

  setBiometricEnabled: (enabled: boolean) => {
    set((state) => ({
      biometric: { ...state.biometric, isEnabled: enabled },
    }));
  },

  setBiometricRegistered: (registered: boolean) => {
    set((state) => ({
      biometric: { ...state.biometric, isRegistered: registered },
    }));
  },

  setSession: (session: AuthSession) => {
    set({ session });
  },

  hydrate: async () => {
    set({ isLoading: true });

    try {
      const storedTokens = await secureStorage.getTokens();
      const storedUser = await secureStorage.getUser();

      if (storedTokens && Date.now() < storedTokens.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
        set({
          tokens: storedTokens,
          user: storedUser,
          isAuthenticated: true,
        });
      } else if (storedTokens?.refreshToken) {
        // Token expired but refresh token available — attempt refresh
        set({ tokens: storedTokens });
        await get().refreshTokens();
      }

      // Restore role state from SecureStore
      const storedRoles = await secureStorage.getRoles();
      const storedActiveRole = await secureStorage.getActiveRole();

      if (storedRoles && storedRoles.length > 0) {
        set({
          roles: storedRoles as UserRole[],
          activeRole: (storedActiveRole as UserRole) ?? null,
        });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  reset: () => {
    set({ ...initialState });

    // Clear all auth data from SecureStore (fire-and-forget)
    secureStorage.clearAll();
  },

  isTokenExpired: (): boolean => {
    const { tokens } = get();

    if (!tokens) {
      return true;
    }

    return Date.now() >= tokens.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  },

  switchRole: (role: UserRole) => {
    const { roles } = get();

    // Validate the role is in the user's assigned roles before switching
    if (!roles.includes(role)) {
      return;
    }

    set({ activeRole: role });

    // Persist activeRole to SecureStore (fire-and-forget)
    secureStorage.storeActiveRole(role);

    // Fire-and-forget PATCH to sync active role with backend
    // Lazy import to avoid circular dependency (api.service imports auth.store)
    import('../services/api.service').then(({ apiClient }) => {
      apiClient
        .patch(ACTIVE_ROLE_ENDPOINT, { activeRole: role })
        .catch(() => {
          // Silent failure — local state is retained, retry can happen later
          // TODO: Queue for retry on next app foreground or connectivity restore
        });
    });
  },

  addRole: (role: UserRole) => {
    const { roles } = get();

    if (roles.includes(role)) {
      return;
    }

    const updatedRoles = [...roles, role];
    set({ roles: updatedRoles });

    // Persist updated roles to SecureStore (fire-and-forget)
    secureStorage.storeRoles(updatedRoles);
  },

  setRoles: (roles: UserRole[], activeRole: UserRole | null) => {
    set({ roles, activeRole });

    // Persist both roles and activeRole to SecureStore (fire-and-forget)
    secureStorage.storeRoles(roles);

    if (activeRole) {
      secureStorage.storeActiveRole(activeRole);
    }
  },
}));

// ─── Selectors ───────────────────────────────────────────────────────────────

/** Select only the access token (for Authorization header in api.service) */
export const selectAccessToken = (state: AuthStore): string | null =>
  state.tokens?.accessToken ?? null;

/** Select authentication status */
export const selectIsAuthenticated = (state: AuthStore): boolean =>
  state.isAuthenticated;

/** Select the current user */
export const selectUser = (state: AuthStore): AuthUser | null => state.user;

/** Select biometric state */
export const selectBiometric = (state: AuthStore): BiometricState =>
  state.biometric;

/** Select loading state */
export const selectIsLoading = (state: AuthStore): boolean => state.isLoading;

/** Select the active role */
export const selectActiveRole = (state: AuthStore): UserRole | null =>
  state.activeRole;

/** Select all assigned roles */
export const selectRoles = (state: AuthStore): UserRole[] => state.roles;

/** Select whether the user has both roles (host + cleaner) */
export const selectHasBothRoles = (state: AuthStore): boolean =>
  state.roles.length === 2;

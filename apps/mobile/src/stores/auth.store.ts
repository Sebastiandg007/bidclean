/**
 * Auth Store — Zustand store for authentication state.
 *
 * Manages user data, tokens, session metadata, and biometric state.
 * Tokens are persisted via SecureStore (implemented in Task 34).
 * Token refresh uses Keycloak token endpoint directly (implemented in Task 33).
 */

import { create } from 'zustand';
import { refreshAccessToken } from '../services/tokenRefresh.service';
import * as secureStorage from '../services/secureStorage.service';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Buffer in milliseconds before token is considered expired (30 seconds) */
const TOKEN_EXPIRY_BUFFER_MS = 30_000;

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
}

export interface AuthActions {
  login: (tokens: AuthTokens, user: AuthUser) => void;
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
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthStore>((set, get) => ({
  ...initialState,

  login: (tokens: AuthTokens, user: AuthUser) => {
    set({
      tokens,
      user,
      isAuthenticated: true,
      isLoading: false,
    });

    // Persist tokens and user to SecureStore (fire-and-forget)
    secureStorage.storeTokens(tokens);
    secureStorage.storeUser(user);
  },

  logout: async () => {
    set({ isLoading: true });

    try {
      // TODO(Task-32): Call API logout endpoint via api.service
      // await apiService.post('/auth/logout');
    } finally {
      get().reset();
    }
  },

  logoutAll: async () => {
    set({ isLoading: true });

    try {
      // TODO(Task-32): Call API logout-all endpoint via api.service
      // await apiService.post('/auth/logout-all');
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

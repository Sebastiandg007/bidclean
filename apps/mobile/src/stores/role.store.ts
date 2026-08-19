/**
 * Role Store — Zustand store for role state management.
 *
 * Manages the user's active role, assigned roles, and role-switching logic.
 * Role state is persisted via SecureStore and restored on app restart.
 *
 * NOTE: This store will be merged into auth.store.ts in Task 18.
 * It exists as a standalone store for now to unblock navigation implementation.
 */

import { create } from 'zustand';

import type { UserRole } from '../screens/roles/roles.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RoleState {
  /** The currently active role determining navigation and visible data */
  activeRole: UserRole | null;
  /** All roles assigned to this user */
  roles: UserRole[];
  /** Whether the role state has been hydrated from persistence */
  isHydrated: boolean;
}

export interface RoleActions {
  /** Switch the active role instantly (fire-and-forget backend sync) */
  switchRole: (role: UserRole) => void;
  /** Set roles from backend response */
  setRoles: (roles: UserRole[], activeRole: UserRole | null) => void;
  /** Mark hydration as complete */
  setHydrated: () => void;
  /** Reset role state (on logout) */
  reset: () => void;
}

export type RoleStore = RoleState & RoleActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: RoleState = {
  activeRole: null,
  roles: [],
  isHydrated: false,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useRoleStore = create<RoleStore>((set) => ({
  ...initialState,

  switchRole: (role: UserRole) => {
    set({ activeRole: role });

    // TODO(Task-21): Persist to SecureStore
    // TODO(Task-18): Fire-and-forget PATCH /users/me/active-role
  },

  setRoles: (roles: UserRole[], activeRole: UserRole | null) => {
    set({ roles, activeRole });
  },

  setHydrated: () => {
    set({ isHydrated: true });
  },

  reset: () => {
    set({ ...initialState });
  },
}));

// ─── Selectors ───────────────────────────────────────────────────────────────

/** Select the active role */
export const selectActiveRole = (state: RoleStore): UserRole | null =>
  state.activeRole;

/** Select all assigned roles */
export const selectRoles = (state: RoleStore): UserRole[] => state.roles;

/** Select whether the user has both roles */
export const selectHasBothRoles = (state: RoleStore): boolean =>
  state.roles.length === 2;

/** Select hydration status */
export const selectIsHydrated = (state: RoleStore): boolean =>
  state.isHydrated;

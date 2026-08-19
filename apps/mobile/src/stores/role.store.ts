/**
 * Role Store — Deprecated compatibility wrapper.
 *
 * @deprecated All role state now lives in auth.store.ts (merged in Task 18).
 * Import directly from './auth.store' instead.
 *
 * This file re-exports role-related state and selectors from the auth store
 * to avoid breaking any remaining imports. New code should use auth.store directly.
 */

export {
  useAuthStore as useRoleStore,
  selectActiveRole,
  selectRoles,
  selectHasBothRoles,
} from './auth.store';

export type { AuthStore as RoleStore } from './auth.store';

/** @deprecated Use selectIsLoading from auth.store (inverted logic) */
export const selectIsHydrated = (state: { isLoading: boolean }): boolean =>
  !state.isLoading;

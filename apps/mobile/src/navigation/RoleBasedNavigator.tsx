/**
 * RoleBasedNavigator — Routes to Host or Cleaner navigation based on active role.
 *
 * This is the root navigation component for authenticated users who have
 * completed onboarding. It reads the active role from the role store and
 * renders the corresponding navigator:
 *
 * - activeRole === 'host'    → HostNavigator (4 tabs)
 * - activeRole === 'cleaner' → CleanerNavigator (3 tabs)
 * - activeRole === null      → Redirects to role selection
 *
 * REQ-4: Host and Cleaner experiences are completely separate.
 * REQ-5: Switching roles instantly swaps the entire navigation.
 */

import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useRoleStore, selectActiveRole, selectIsHydrated } from '../stores/role.store';
import type { UserRole } from '../screens/roles/roles.types';
import HostNavigator from './HostNavigator';
import CleanerNavigator from './CleanerNavigator';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  accent: '#00F5D4',
} as const;

// ─── Route Constants ─────────────────────────────────────────────────────────

const ROUTES = {
  roleSelection: '/roles/selection',
} as const;

// ─── Navigator Map ───────────────────────────────────────────────────────────

/** Maps each role to its corresponding navigator component */
const NAVIGATOR_BY_ROLE: Record<UserRole, React.ComponentType> = {
  host: HostNavigator,
  cleaner: CleanerNavigator,
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders the correct navigator based on the user's active role.
 *
 * - Shows a loading indicator while the role state hydrates from SecureStore.
 * - Redirects to role selection when no active role is set.
 * - Renders HostNavigator or CleanerNavigator based on activeRole value.
 */
export default function RoleBasedNavigator() {
  const activeRole = useRoleStore(selectActiveRole);
  const isHydrated = useRoleStore(selectIsHydrated);
  const router = useRouter();

  if (!isHydrated) {
    return <LoadingView />;
  }

  if (!activeRole) {
    redirectToRoleSelection(router);
    return <LoadingView />;
  }

  const Navigator = NAVIGATOR_BY_ROLE[activeRole];

  return <Navigator />;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Loading state shown while role data hydrates from persistence.
 */
function LoadingView() {
  return (
    <View
      style={styles.loadingContainer}
      accessibilityRole="progressbar"
      testID="role-navigator-loading"
    >
      <ActivityIndicator size="large" color={COLORS.accent} />
    </View>
  );
}

/**
 * Navigate to role selection when no active role is available.
 * Uses replace to prevent back-navigation to this empty state.
 */
function redirectToRoleSelection(router: ReturnType<typeof useRouter>) {
  // Defer navigation to avoid React state-update-during-render warning
  setTimeout(() => {
    router.replace(ROUTES.roleSelection as never);
  }, 0);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

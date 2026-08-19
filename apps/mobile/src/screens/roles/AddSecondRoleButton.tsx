/**
 * AddSecondRoleButton — Allows users with a single role to add the second role.
 *
 * Only renders when the user has exactly ONE role assigned.
 * On press:
 * 1. Calls POST /users/roles with both roles (idempotent)
 * 2. Updates local auth store via addRole
 * 3. Navigates to the onboarding screen for the newly added role
 *
 * REQ-6: Adding a second role triggers the onboarding flow for that role.
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import {
  useAuthStore,
  selectRoles,
  selectHasBothRoles,
} from '../../stores/auth.store';
import type { UserRole } from './roles.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  error: '#FF6B6B',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  button: 16,
} as const;

const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
  mass: 0.5,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLES_ENDPOINT = '/users/roles';

/** Maps each role to its corresponding onboarding route */
const ONBOARDING_ROUTES: Record<UserRole, string> = {
  host: '/(onboarding)/host',
  cleaner: '/(onboarding)/cleaner',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the role the user is missing */
function getMissingRole(currentRoles: UserRole[]): UserRole | null {
  if (currentRoles.length !== 1) return null;
  return currentRoles[0] === 'host' ? 'cleaner' : 'host';
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Button that allows a single-role user to add the second role.
 * Only visible when the user has exactly one role (Host or Cleaner).
 * Triggers onboarding for the newly added role on success.
 */
export default function AddSecondRoleButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const roles = useAuthStore(selectRoles);
  const hasBothRoles = useAuthStore(selectHasBothRoles);
  const addRole = useAuthStore((state) => state.addRole);
  const scale = useSharedValue(1);
  const [isLoading, setIsLoading] = useState(false);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, SPRING_CONFIG);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_CONFIG);
  }, [scale]);

  const handlePress = useCallback(async () => {
    const missingRole = getMissingRole(roles);
    if (!missingRole || isLoading) return;

    setIsLoading(true);

    try {
      const { apiClient } = await import('../../services/api.service');
      await apiClient.post(ROLES_ENDPOINT, { roles: ['host', 'cleaner'] });

      addRole(missingRole);
      router.push(ONBOARDING_ROUTES[missingRole]);
    } catch {
      Alert.alert(
        t('roles.addRole.error.title', { defaultValue: 'Error' }),
        t('roles.addRole.error.message', {
          defaultValue: 'Could not add role. Please try again.',
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [roles, isLoading, addRole, router, t]);

  // Only render when user has exactly one role
  if (hasBothRoles || roles.length === 0) {
    return null;
  }

  const missingRole = getMissingRole(roles);
  if (!missingRole) return null;

  const roleLabel = t(`roles.addRole.target.${missingRole}`, {
    defaultValue: missingRole === 'host' ? 'Host' : 'Cleaner',
  });
  const buttonLabel = isLoading
    ? t('roles.addRole.loading', { defaultValue: 'Adding...' })
    : t('roles.addRole.button', {
        defaultValue: `Add ${roleLabel} role`,
        role: roleLabel,
      });
  const a11yLabel = t('roles.addRole.a11y', {
    defaultValue: `Add ${roleLabel} role to your account`,
    role: roleLabel,
  });

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled: isLoading, busy: isLoading }}
      disabled={isLoading}
      testID="add-second-role-button"
    >
      <Animated.View
        style={[styles.container, animatedStyle, isLoading && styles.disabled]}
      >
        <Text style={styles.label}>{buttonLabel}</Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.accent,
  },
});

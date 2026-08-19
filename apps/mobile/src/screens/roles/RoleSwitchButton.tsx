/**
 * RoleSwitchButton — Allows users with both roles to switch between Host and Cleaner.
 *
 * Only renders when the user has both roles assigned.
 * Calls switchRole from auth store on press, which:
 * - Instantly updates activeRole (navigation swaps immediately)
 * - Fires async PATCH to persist preference (fire-and-forget)
 *
 * REQ-5: Role switching is instant, no re-authentication needed.
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import {
  useAuthStore,
  selectActiveRole,
  selectHasBothRoles,
} from '../../stores/auth.store';
import type { UserRole } from './roles.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the opposite role to enable switching */
function getOppositeRole(currentRole: UserRole): UserRole {
  return currentRole === 'host' ? 'cleaner' : 'host';
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Button that switches the active role to the opposite one.
 * Only visible when the user has both Host and Cleaner roles assigned.
 */
export default function RoleSwitchButton() {
  const { t } = useTranslation();
  const activeRole = useAuthStore(selectActiveRole);
  const hasBothRoles = useAuthStore(selectHasBothRoles);
  const switchRole = useAuthStore((state) => state.switchRole);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, SPRING_CONFIG);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_CONFIG);
  }, [scale]);

  const handlePress = useCallback(() => {
    if (!activeRole) return;
    const targetRole = getOppositeRole(activeRole);
    switchRole(targetRole);
  }, [activeRole, switchRole]);

  if (!hasBothRoles || !activeRole) {
    return null;
  }

  const targetRole = getOppositeRole(activeRole);
  const targetLabel = t(`roles.switch.target.${targetRole}`, {
    defaultValue: targetRole === 'host' ? 'Host' : 'Cleaner',
  });
  const buttonLabel = t('roles.switch.button', {
    defaultValue: `Switch to ${targetLabel}`,
    role: targetLabel,
  });
  const a11yLabel = t('roles.switch.a11y', {
    defaultValue: `Switch your active role to ${targetLabel}`,
    role: targetLabel,
  });

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      testID="role-switch-button"
    >
      <Animated.View style={[styles.container, animatedStyle]}>
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
  label: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.accent,
  },
});

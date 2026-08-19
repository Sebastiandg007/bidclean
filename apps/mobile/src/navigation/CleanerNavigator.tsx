/**
 * CleanerNavigator — Placeholder for Cleaner tab navigation.
 *
 * Will be fully implemented in Task 17 with 3 tabs:
 * Radar, Active, Profile.
 *
 * This placeholder exists so RoleBasedNavigator compiles.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
} as const;

const SPACING = {
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  title: 22,
  body: 14,
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Placeholder Cleaner Navigator.
 * Replaced by full tab navigation in Task 17.
 */
export default function CleanerNavigator() {
  const { t } = useTranslation();

  return (
    <View style={styles.container} accessibilityRole="none">
      <View style={styles.card}>
        <Text style={styles.title}>
          {t('navigation.cleaner.placeholder.title', { defaultValue: 'Cleaner Experience' })}
        </Text>
        <Text style={styles.subtitle}>
          {t('navigation.cleaner.placeholder.description', {
            defaultValue: 'Radar • Active • Profile',
          })}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

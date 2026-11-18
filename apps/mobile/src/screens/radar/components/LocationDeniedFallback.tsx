/**
 * LocationDeniedFallback — Full-screen explanation shown when location permission is denied.
 *
 * Provides:
 * - Clear explanation of why location is needed (i18n text)
 * - "Allow Location" button to re-request permission
 * - "Open Settings" button for users who permanently denied
 *
 * GPS is used ONLY for: map centering, distance display, position marker.
 * It does NOT affect offer delivery eligibility.
 *
 * @requirements 9.1, 9.2, 9.3
 */

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../../theme';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

const FONT_SIZE = {
  title: 20,
  body: 15,
  button: 15,
  illustration: 48,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const ILLUSTRATION_SIZE = 120;
const ILLUSTRATION_BORDER_RADIUS = 60;
const BUTTON_BORDER_RADIUS = 12;
const BUTTON_PADDING_VERTICAL = 14;
const BUTTON_PADDING_HORIZONTAL = 28;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface LocationDeniedFallbackProps {
  /** Attempt to request location permission again */
  onRequestPermission: () => void;
  /** Open device app settings for permission management */
  onOpenSettings: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LocationDeniedFallback({
  onRequestPermission,
  onOpenSettings,
}: LocationDeniedFallbackProps): React.JSX.Element {
  const { t } = useTranslation('radar');
  const styles = useStyles();

  return (
    <View style={styles.container} testID="location-denied-fallback">
      {/* Illustration */}
      <View style={styles.illustrationContainer}>
        <Text style={styles.illustrationEmoji}>{'📍'}</Text>
      </View>

      {/* Title */}
      <Text style={styles.title}>{t('location.deniedTitle')}</Text>

      {/* Explanation */}
      <Text style={styles.explanation}>{t('location.deniedExplanation')}</Text>

      {/* Allow Location Button (primary) */}
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={onRequestPermission}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID="location-allow-button"
      >
        <Text style={styles.primaryButtonText}>
          {t('location.allowButton')}
        </Text>
      </TouchableOpacity>

      {/* Open Settings Button (secondary) */}
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={onOpenSettings}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID="location-settings-button"
      >
        <Text style={styles.secondaryButtonText}>
          {t('location.openSettings')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    backgroundColor: theme.background,
  },
  illustrationContainer: {
    width: ILLUSTRATION_SIZE,
    height: ILLUSTRATION_SIZE,
    borderRadius: ILLUSTRATION_BORDER_RADIUS,
    backgroundColor: theme.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  illustrationEmoji: {
    fontSize: FONT_SIZE.illustration,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  explanation: {
    fontSize: FONT_SIZE.body,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  primaryButton: {
    backgroundColor: theme.accent,
    borderRadius: BUTTON_BORDER_RADIUS,
    paddingVertical: BUTTON_PADDING_VERTICAL,
    paddingHorizontal: BUTTON_PADDING_HORIZONTAL,
    marginBottom: SPACING.md,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: theme.onAccent,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: BUTTON_BORDER_RADIUS,
    paddingVertical: BUTTON_PADDING_VERTICAL,
    paddingHorizontal: BUTTON_PADDING_HORIZONTAL,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '500',
    color: theme.textPrimary,
  },
}));

export default LocationDeniedFallback;

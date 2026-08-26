/**
 * EmptyState — Friendly empty state for the Offer Radar.
 *
 * Two variants:
 * 1. No offers available — suggests expanding work zone (CTA button)
 * 2. All offers filtered out — suggests clearing filters (CTA button)
 *
 * Includes illustration placeholder area and i18n text.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRadarStore } from '../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

const FONT_SIZE = {
  title: 18,
  body: 14,
  button: 14,
  illustration: 48,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const ILLUSTRATION_SIZE = 120;
const ILLUSTRATION_BORDER_RADIUS = 60;
const BUTTON_BORDER_RADIUS = 10;
const BUTTON_PADDING_VERTICAL = 12;
const BUTTON_PADDING_HORIZONTAL = 24;

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmptyStateVariant = 'no-offers' | 'no-matching-filters';

export interface EmptyStateProps {
  /** Which variant to display */
  variant: EmptyStateVariant;
  /** Callback for the CTA — expand work zone (no-offers) or clear filters (filtered) */
  onAction?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EmptyState({ variant, onAction }: EmptyStateProps): React.JSX.Element {
  const { t } = useTranslation('radar');
  const clearFilters = useRadarStore((state) => state.clearFilters);

  const isFiltered = variant === 'no-matching-filters';

  const title = isFiltered
    ? t('empty.noMatchingOffers')
    : t('empty.noOffers');

  const subtitle = isFiltered ? undefined : t('empty.noOffersSuggestion');

  const buttonLabel = isFiltered
    ? t('empty.clearFilters')
    : t('empty.expandWorkZone');

  const illustrationEmoji = isFiltered ? '🔍' : '📍';

  const handlePress = (): void => {
    if (isFiltered) {
      clearFilters();
    }
    onAction?.();
  };

  return (
    <View style={styles.container} testID={`empty-state-${variant}`}>
      {/* Illustration Placeholder */}
      <View style={styles.illustrationContainer}>
        <Text style={styles.illustrationEmoji}>{illustrationEmoji}</Text>
      </View>

      {/* Title */}
      <Text style={styles.title}>{title}</Text>

      {/* Subtitle (only for no-offers variant) */}
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      {/* CTA Button */}
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={handlePress}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID={`empty-state-cta-${variant}`}
      >
        <Text style={styles.ctaButtonText}>{buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.background,
  },
  illustrationContainer: {
    width: ILLUSTRATION_SIZE,
    height: ILLUSTRATION_SIZE,
    borderRadius: ILLUSTRATION_BORDER_RADIUS,
    backgroundColor: COLORS.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  illustrationEmoji: {
    fontSize: FONT_SIZE.illustration,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  ctaButton: {
    backgroundColor: COLORS.accentSubtle,
    borderRadius: BUTTON_BORDER_RADIUS,
    paddingVertical: BUTTON_PADDING_VERTICAL,
    paddingHorizontal: BUTTON_PADDING_HORIZONTAL,
    marginTop: SPACING.md,
  },
  ctaButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.accent,
  },
});

export default EmptyState;

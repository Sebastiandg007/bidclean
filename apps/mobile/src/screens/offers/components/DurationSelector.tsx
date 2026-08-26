/**
 * DurationSelector component.
 *
 * Numeric stepper for selecting offer duration in minutes.
 * Displays the value in "Xh Ym" format and clamps to
 * configurable min/max bounds from offers.constants.
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  COLORS,
  FONT_SIZE,
  OFFER_MIN_DURATION_MINUTES,
  OFFER_MAX_DURATION_MINUTES,
  OFFER_DURATION_STEP_MINUTES,
  SPACING,
} from '../offers.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DurationSelectorProps {
  /** Current duration value in minutes */
  value: number;
  /** Callback fired with the new clamped duration in minutes */
  onChange: (minutes: number) => void;
  /** Minimum allowed duration in minutes (default from constants) */
  min?: number;
  /** Maximum allowed duration in minutes (default from constants) */
  max?: number;
  /** Step increment in minutes (default from constants) */
  step?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats a duration in minutes to "Xh Ym" display string.
 * Examples: 30 → "0h 30m", 90 → "1h 30m", 120 → "2h 0m"
 */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

/**
 * Clamps a value to the [min, max] range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DurationSelector({
  value,
  onChange,
  min = OFFER_MIN_DURATION_MINUTES,
  max = OFFER_MAX_DURATION_MINUTES,
  step = OFFER_DURATION_STEP_MINUTES,
}: DurationSelectorProps) {
  const { t } = useTranslation('offers');

  const isAtMin = value <= min;
  const isAtMax = value >= max;

  function handleDecrease() {
    if (isAtMin) return;
    const next = clamp(value - step, min, max);
    onChange(next);
  }

  function handleIncrease() {
    if (isAtMax) return;
    const next = clamp(value + step, min, max);
    onChange(next);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t('duration.label')}</Text>

      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.button, isAtMin && styles.buttonDisabled]}
          onPress={handleDecrease}
          disabled={isAtMin}
          accessibilityLabel={t('duration.decrease')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isAtMin }}
        >
          <Text style={[styles.buttonText, isAtMin && styles.buttonTextDisabled]}>
            −
          </Text>
        </TouchableOpacity>

        <View style={styles.valueContainer}>
          <Text style={styles.valueText}>{formatDuration(value)}</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, isAtMax && styles.buttonDisabled]}
          onPress={handleIncrease}
          disabled={isAtMax}
          accessibilityLabel={t('duration.increase')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isAtMax }}
        >
          <Text style={[styles.buttonText, isAtMax && styles.buttonTextDisabled]}>
            +
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  label: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  buttonText: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.background,
  },
  buttonTextDisabled: {
    color: COLORS.textSecondary,
  },
  valueContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    fontSize: FONT_SIZE.large,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});

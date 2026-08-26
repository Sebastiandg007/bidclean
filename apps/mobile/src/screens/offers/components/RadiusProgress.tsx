/**
 * RadiusProgress — Displays current radius, progress bar toward max,
 * and a countdown timer for the next expansion step.
 *
 * - Current radius formatted as km (1 decimal)
 * - Horizontal progress bar showing current/max ratio
 * - Countdown timer "Next expansion in X:XX" (only when isActive)
 * - "Maximum radius reached" when currentRadius >= maxRadius
 * - Cleans up interval on unmount
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING, FONT_SIZE } from '../offers.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RadiusProgressProps {
  /** Current radius in meters */
  currentRadiusMeters: number;
  /** Maximum radius in meters */
  maxRadiusMeters: number;
  /** Expansion interval in milliseconds */
  expansionIntervalMs: number;
  /** ISO timestamp of last expansion (null if not yet expanded) */
  lastExpandedAt: string | null;
  /** Only show countdown timer when offer is ACTIVE */
  isActive: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const METERS_PER_KM = 1000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const TICK_INTERVAL_MS = 1000;
const BORDER_RADIUS = 12;
const PROGRESS_BAR_HEIGHT = 6;
const PROGRESS_BAR_RADIUS = 3;
const LETTER_SPACING = 0.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converts meters to km with 1 decimal precision */
function metersToKm(meters: number): string {
  return (meters / METERS_PER_KM).toFixed(1);
}

/** Calculates remaining ms until next expansion */
function calculateRemainingMs(
  lastExpandedAt: string | null,
  expansionIntervalMs: number,
): number {
  if (!lastExpandedAt) {
    return 0;
  }

  const lastExpanded = new Date(lastExpandedAt).getTime();
  const nextExpansionAt = lastExpanded + expansionIntervalMs;
  const remaining = nextExpansionAt - Date.now();

  return Math.max(0, remaining);
}

/** Formats milliseconds as "M:SS" */
function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RadiusProgress({
  currentRadiusMeters,
  maxRadiusMeters,
  expansionIntervalMs,
  lastExpandedAt,
  isActive,
}: RadiusProgressProps): React.JSX.Element {
  const { t } = useTranslation();

  const [remainingMs, setRemainingMs] = useState<number>(() =>
    calculateRemainingMs(lastExpandedAt, expansionIntervalMs),
  );

  const hasReachedMax = currentRadiusMeters >= maxRadiusMeters;
  const showCountdown = isActive && !hasReachedMax;

  const progressRatio = useMemo(() => {
    if (maxRadiusMeters <= 0) return 0;
    return Math.min(currentRadiusMeters / maxRadiusMeters, 1);
  }, [currentRadiusMeters, maxRadiusMeters]);

  const currentKm = useMemo(
    () => metersToKm(currentRadiusMeters),
    [currentRadiusMeters],
  );

  const maxKm = useMemo(() => metersToKm(maxRadiusMeters), [maxRadiusMeters]);

  // ─── Countdown Timer Effect ──────────────────────────────────────────────

  const tick = useCallback(() => {
    setRemainingMs(calculateRemainingMs(lastExpandedAt, expansionIntervalMs));
  }, [lastExpandedAt, expansionIntervalMs]);

  useEffect(() => {
    if (!showCountdown) {
      return;
    }

    tick();

    const intervalId = setInterval(tick, TICK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [showCountdown, tick]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container} testID="radius-progress">
      {/* Current radius display */}
      <View style={styles.radiusHeader}>
        <Text style={styles.radiusLabel}>
          {t('offers.radiusProgress.currentRadius')}
        </Text>
        <Text style={styles.radiusValue}>
          {t('offers.radiusProgress.radiusKm', { value: currentKm })}
        </Text>
      </View>

      {/* Progress bar */}
      <View
        style={styles.progressBarContainer}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: maxRadiusMeters,
          now: currentRadiusMeters,
        }}
        accessibilityLabel={t('offers.radiusProgress.a11yProgressLabel')}
      >
        <View
          style={[
            styles.progressBarFill,
            { width: `${progressRatio * 100}%` },
          ]}
        />
      </View>

      {/* Min/Max labels */}
      <View style={styles.labelsRow}>
        <Text style={styles.labelMin}>
          {t('offers.radiusProgress.radiusKm', { value: '0' })}
        </Text>
        <Text style={styles.labelMax}>
          {t('offers.radiusProgress.radiusKm', { value: maxKm })}
        </Text>
      </View>

      {/* Countdown or max-reached message */}
      {showCountdown && (
        <Text style={styles.countdown} testID="radius-countdown">
          {t('offers.radiusProgress.nextExpansion', {
            time: formatCountdown(remainingMs),
          })}
        </Text>
      )}

      {hasReachedMax && (
        <Text style={styles.maxReached} testID="radius-max-reached">
          {t('offers.radiusProgress.maxReached')}
        </Text>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS,
    padding: SPACING.md,
  },
  radiusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  radiusLabel: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: LETTER_SPACING,
  },
  radiusValue: {
    fontSize: FONT_SIZE.large,
    fontWeight: '700',
    color: COLORS.accent,
  },
  progressBarContainer: {
    height: PROGRESS_BAR_HEIGHT,
    backgroundColor: COLORS.accentMuted,
    borderRadius: PROGRESS_BAR_RADIUS,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: PROGRESS_BAR_RADIUS,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  labelMin: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  labelMax: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  countdown: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginTop: SPACING.md,
    fontWeight: '500',
  },
  maxReached: {
    fontSize: FONT_SIZE.body,
    color: COLORS.success,
    textAlign: 'center',
    marginTop: SPACING.md,
    fontWeight: '600',
  },
});

export default RadiusProgress;

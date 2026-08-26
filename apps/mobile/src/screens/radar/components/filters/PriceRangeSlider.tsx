/**
 * PriceRangeSlider — Dual-thumb slider for filtering offers by Cleaner payout range.
 *
 * Displays min/max price in local currency format.
 * Uses a custom PanResponder-based dual slider (no external dependency).
 * Updates store via setFilters({ minPriceCents, maxPriceCents }).
 *
 * Requirements: 5.1
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRadarStore } from '../../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  trackInactive: 'rgba(255, 255, 255, 0.15)',
  trackActive: '#00F5D4',
  thumb: '#FFFFFF',
} as const;

const SPACING = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

const FONT_SIZE = {
  label: 16,
  value: 14,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const TRACK_HEIGHT = 4;
const TRACK_BORDER_RADIUS = 2;
const THUMB_SIZE = 24;
const THUMB_BORDER_RADIUS = 12;
const HIT_SLOP_SIZE = 12;

/** Range bounds in cents (0 to 50,000 cents = $0 to $500) */
const MIN_PRICE_CENTS = 0;
const MAX_PRICE_CENTS = 50_000;
const CENTS_DIVISOR = 100;

/** Step value for price in cents ($5 increments) */
const PRICE_STEP_CENTS = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatCents(cents: number, currency: string): string {
  const amount = cents / CENTS_DIVISOR;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PriceRangeSlider(): React.JSX.Element {
  const { t } = useTranslation('radar');
  const minPriceCents = useRadarStore((state) => state.filters.minPriceCents);
  const maxPriceCents = useRadarStore((state) => state.filters.maxPriceCents);
  const setFilters = useRadarStore((state) => state.setFilters);

  const [trackWidth, setTrackWidth] = useState(0);
  const trackLayoutRef = useRef({ x: 0, width: 0 });

  // Current values (use defaults if null)
  const currentMin = minPriceCents ?? MIN_PRICE_CENTS;
  const currentMax = maxPriceCents ?? MAX_PRICE_CENTS;

  // Position percentages
  const minPercent = (currentMin - MIN_PRICE_CENTS) / (MAX_PRICE_CENTS - MIN_PRICE_CENTS);
  const maxPercent = (currentMax - MIN_PRICE_CENTS) / (MAX_PRICE_CENTS - MIN_PRICE_CENTS);

  // Currency (default USD, will be overridden by user preferences)
  const currency = 'USD';

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, x } = event.nativeEvent.layout;
    trackLayoutRef.current = { x, width };
    setTrackWidth(width);
  }, []);

  const positionToValue = useCallback((positionX: number): number => {
    const percent = clamp(positionX / trackLayoutRef.current.width, 0, 1);
    const rawValue = MIN_PRICE_CENTS + percent * (MAX_PRICE_CENTS - MIN_PRICE_CENTS);
    return snapToStep(rawValue, PRICE_STEP_CENTS);
  }, []);

  // Min thumb pan responder
  const minPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const currentPosition = minPercent * trackLayoutRef.current.width + gestureState.dx;
        const newValue = positionToValue(currentPosition);
        const clampedValue = clamp(newValue, MIN_PRICE_CENTS, currentMax - PRICE_STEP_CENTS);
        setFilters({ minPriceCents: clampedValue === MIN_PRICE_CENTS ? null : clampedValue });
      },
      onPanResponderRelease: () => {},
    }),
  ).current;

  // Max thumb pan responder
  const maxPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const currentPosition = maxPercent * trackLayoutRef.current.width + gestureState.dx;
        const newValue = positionToValue(currentPosition);
        const clampedValue = clamp(newValue, currentMin + PRICE_STEP_CENTS, MAX_PRICE_CENTS);
        setFilters({ maxPriceCents: clampedValue === MAX_PRICE_CENTS ? null : clampedValue });
      },
      onPanResponderRelease: () => {},
    }),
  ).current;

  const formattedMin = useMemo(() => formatCents(currentMin, currency), [currentMin, currency]);
  const formattedMax = useMemo(() => formatCents(currentMax, currency), [currentMax, currency]);

  return (
    <View style={styles.container} testID="price-range-slider">
      <Text style={styles.label}>{t('filter.priceRange.label')}</Text>

      {/* Value labels */}
      <View style={styles.valueRow}>
        <Text style={styles.valueText}>
          {t('filter.priceRange.min')}: {formattedMin}
        </Text>
        <Text style={styles.valueText}>
          {t('filter.priceRange.max')}: {formattedMax}
        </Text>
      </View>

      {/* Track */}
      <View
        style={styles.trackContainer}
        onLayout={handleTrackLayout}
      >
        {/* Inactive track (full width) */}
        <View style={styles.trackInactive} />

        {/* Active track (between thumbs) */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.trackActive,
              {
                left: minPercent * trackWidth,
                width: (maxPercent - minPercent) * trackWidth,
              },
            ]}
          />
        )}

        {/* Min thumb */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.thumb,
              { left: minPercent * trackWidth - THUMB_SIZE / 2 },
            ]}
            hitSlop={{ top: HIT_SLOP_SIZE, bottom: HIT_SLOP_SIZE, left: HIT_SLOP_SIZE, right: HIT_SLOP_SIZE }}
            {...minPanResponder.panHandlers}
            testID="price-slider-min-thumb"
          />
        )}

        {/* Max thumb */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.thumb,
              { left: maxPercent * trackWidth - THUMB_SIZE / 2 },
            ]}
            hitSlop={{ top: HIT_SLOP_SIZE, bottom: HIT_SLOP_SIZE, left: HIT_SLOP_SIZE, right: HIT_SLOP_SIZE }}
            {...maxPanResponder.panHandlers}
            testID="price-slider-max-thumb"
          />
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  valueText: {
    fontSize: FONT_SIZE.value,
    color: COLORS.textSecondary,
  },
  trackContainer: {
    height: THUMB_SIZE,
    justifyContent: 'center',
  },
  trackInactive: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_BORDER_RADIUS,
    backgroundColor: COLORS.trackInactive,
  },
  trackActive: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_BORDER_RADIUS,
    backgroundColor: COLORS.trackActive,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_BORDER_RADIUS,
    backgroundColor: COLORS.thumb,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});

export default PriceRangeSlider;

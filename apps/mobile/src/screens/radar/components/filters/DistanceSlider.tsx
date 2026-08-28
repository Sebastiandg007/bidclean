/**
 * DistanceSlider — Single-thumb slider for filtering offers by max distance.
 *
 * Displays distance in km (metric) or miles (US/UK) based on user locale.
 * Uses a custom PanResponder-based slider (no external dependency).
 * Updates store via setFilters({ maxDistanceMeters }).
 *
 * Requirements: 5.1
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { NativeModules } from 'react-native';

import { useRadarStore } from '../../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  accent: '#00F5D4',
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

/** Max distance in meters (50 km) */
const MAX_DISTANCE_METERS = 50_000;

/** Step in meters (500m) */
const DISTANCE_STEP_METERS = 500;

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

/** Locales that use miles */
const IMPERIAL_LOCALES = ['en-US', 'en-GB'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function getDeviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      return settings?.AppleLocale || settings?.AppleLanguages?.[0] || 'en-US';
    }
    return NativeModules.I18nManager?.localeIdentifier || 'en-US';
  } catch {
    return 'en-US';
  }
}

function useImperialUnits(): boolean {
  const locale = getDeviceLocale();
  return IMPERIAL_LOCALES.some((l) => {
    const language = l.split('-')[0] ?? l;
    return locale.startsWith(language);
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DistanceSlider(): React.JSX.Element {
  const { t } = useTranslation('radar');
  const maxDistanceMeters = useRadarStore((state) => state.filters.maxDistanceMeters);
  const setFilters = useRadarStore((state) => state.setFilters);

  const [trackWidth, setTrackWidth] = useState(0);
  const trackLayoutRef = useRef({ x: 0, width: 0 });

  const isImperial = useImperialUnits();
  const currentValue = maxDistanceMeters ?? MAX_DISTANCE_METERS;
  const percent = currentValue / MAX_DISTANCE_METERS;

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, x } = event.nativeEvent.layout;
    trackLayoutRef.current = { x, width };
    setTrackWidth(width);
  }, []);

  const positionToValue = useCallback((positionX: number): number => {
    const pct = clamp(positionX / trackLayoutRef.current.width, 0, 1);
    const rawValue = pct * MAX_DISTANCE_METERS;
    return snapToStep(rawValue, DISTANCE_STEP_METERS);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const currentPosition = percent * trackLayoutRef.current.width + gestureState.dx;
        const newValue = positionToValue(currentPosition);
        const clamped = clamp(newValue, DISTANCE_STEP_METERS, MAX_DISTANCE_METERS);
        setFilters({ maxDistanceMeters: clamped === MAX_DISTANCE_METERS ? null : clamped });
      },
      onPanResponderRelease: () => {},
    }),
  ).current;

  const formattedDistance = useMemo(() => {
    if (isImperial) {
      const miles = currentValue / METERS_PER_MILE;
      return t('filter.distance.miles', { value: miles.toFixed(1) });
    }
    const km = currentValue / METERS_PER_KM;
    return t('filter.distance.km', { value: km.toFixed(1) });
  }, [currentValue, isImperial, t]);

  const isAtMax = currentValue === MAX_DISTANCE_METERS;

  return (
    <View style={styles.container} testID="distance-slider">
      <Text style={styles.label}>{t('filter.distance.label')}</Text>

      {/* Value display */}
      <View style={styles.valueRow}>
        <Text style={styles.valueText}>
          {isAtMax ? `${formattedDistance}+` : formattedDistance}
        </Text>
      </View>

      {/* Track */}
      <View style={styles.trackContainer} onLayout={handleTrackLayout}>
        {/* Inactive track */}
        <View style={styles.trackInactive} />

        {/* Active track (from left to thumb) */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.trackActive,
              { width: percent * trackWidth },
            ]}
          />
        )}

        {/* Thumb */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.thumb,
              { left: percent * trackWidth - THUMB_SIZE / 2 },
            ]}
            hitSlop={{ top: HIT_SLOP_SIZE, bottom: HIT_SLOP_SIZE, left: HIT_SLOP_SIZE, right: HIT_SLOP_SIZE }}
            {...panResponder.panHandlers}
            testID="distance-slider-thumb"
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
    marginBottom: SPACING.lg,
  },
  valueText: {
    fontSize: FONT_SIZE.value,
    color: COLORS.accent,
    fontWeight: '600',
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
    left: 0,
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

export default DistanceSlider;

/**
 * CleanerMarker — Animated self-position marker for the Cleaner on the Radar map.
 *
 * Renders the Cleaner's GPS position with a pulsing ring animation
 * using Reanimated 3 to indicate "live" status. Visually distinct from
 * offer pins to avoid confusion.
 *
 * Props:
 * - location: Cleaner's current GPS position (GeoPoint)
 *
 * Animation: Pulsing ring scales from minScale → maxScale with fading
 * opacity, using CLEANER_PULSE_CONFIG timing from constants.
 *
 * Requirements: 1.3, 9.4
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import type { GeoPoint } from '../../radar.types';
import { CLEANER_PULSE_CONFIG, LAYER_IDS } from '../../radar.constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const INNER_DOT_SIZE = 16;
const OUTER_RING_SIZE = 40;
const ACCENT_COLOR = '#00F5D4';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CleanerMarkerProps {
  /** Cleaner's current GPS position */
  location: GeoPoint;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const CleanerMarker: React.FC<CleanerMarkerProps> = React.memo(
  ({ location }) => {
    const scale = useSharedValue<number>(CLEANER_PULSE_CONFIG.minScale);
    const opacity = useSharedValue<number>(CLEANER_PULSE_CONFIG.maxOpacity);

    useEffect(() => {
      const halfDuration = CLEANER_PULSE_CONFIG.durationMs / 2;

      scale.value = withRepeat(
        withSequence(
          withTiming(CLEANER_PULSE_CONFIG.maxScale, {
            duration: halfDuration,
            easing: Easing.out(Easing.ease),
          }),
          withTiming(CLEANER_PULSE_CONFIG.minScale, {
            duration: halfDuration,
            easing: Easing.in(Easing.ease),
          }),
        ),
        -1, // infinite repeat
        false,
      );

      opacity.value = withRepeat(
        withSequence(
          withTiming(CLEANER_PULSE_CONFIG.minOpacity, {
            duration: halfDuration,
            easing: Easing.out(Easing.ease),
          }),
          withTiming(CLEANER_PULSE_CONFIG.maxOpacity, {
            duration: halfDuration,
            easing: Easing.in(Easing.ease),
          }),
        ),
        -1,
        false,
      );
    }, [scale, opacity]);

    const pulseStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    }));

    return (
      <MapboxGL.MarkerView
        id={LAYER_IDS.CLEANER_MARKER}
        coordinate={[location.lng, location.lat]}
        testID="cleaner-marker"
      >
        <View style={styles.container} testID="cleaner-marker-container">
          {/* Pulsing outer ring */}
          <Animated.View style={[styles.pulseRing, pulseStyle]} testID="cleaner-pulse-ring" />
          {/* Static inner dot */}
          <View style={styles.innerDot} testID="cleaner-inner-dot" />
        </View>
      </MapboxGL.MarkerView>
    );
  },
);

CleanerMarker.displayName = 'CleanerMarker';

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: OUTER_RING_SIZE,
    height: OUTER_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: OUTER_RING_SIZE,
    height: OUTER_RING_SIZE,
    borderRadius: OUTER_RING_SIZE / 2,
    borderWidth: 2,
    borderColor: ACCENT_COLOR,
    backgroundColor: 'transparent',
  },
  innerDot: {
    width: INNER_DOT_SIZE,
    height: INNER_DOT_SIZE,
    borderRadius: INNER_DOT_SIZE / 2,
    backgroundColor: ACCENT_COLOR,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});

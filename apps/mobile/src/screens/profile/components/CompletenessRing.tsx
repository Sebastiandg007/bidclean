/**
 * CompletenessRing — Animated circular progress ring with percentage display.
 *
 * Uses react-native-reanimated for smooth fill animation.
 * Renders concentric circle Views with rotating clipping masks.
 * Brand accent color for the filled portion, muted for the background track.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  accent: '#00F5D4',
  track: '#1F2833',
  textPrimary: '#FFFFFF',
  background: '#0B0C10',
} as const;

const RING_SIZE = 100;
const RING_STROKE_WIDTH = 8;
const ANIMATION_DURATION_MS = 800;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompletenessRingProps {
  /** Percentage value between 0 and 100 */
  percentage: number;
  /** Optional size override (diameter in px) */
  size?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Animated circular progress indicator showing profile completeness.
 * Animates smoothly when percentage changes.
 */
export function CompletenessRing({
  percentage,
  size = RING_SIZE,
}: CompletenessRingProps): React.JSX.Element {
  const { t } = useTranslation();
  const progress = useSharedValue(0);
  const clampedPercentage = Math.min(Math.max(percentage, 0), 100);

  useEffect(() => {
    progress.value = withTiming(clampedPercentage / 100, {
      duration: ANIMATION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [clampedPercentage, progress]);

  const halfSize = size / 2;
  const innerSize = size - RING_STROKE_WIDTH * 2;

  // Left half rotation (0–180°)
  const leftHalfStyle = useAnimatedStyle(() => {
    const rotation = Math.min(progress.value * 360, 180);
    return { transform: [{ rotateZ: `${rotation}deg` }] };
  });

  // Right half rotation (180–360°)
  const rightHalfStyle = useAnimatedStyle(() => {
    const rotation = Math.max((progress.value * 360) - 180, 0);
    return { transform: [{ rotateZ: `${rotation}deg` }] };
  });

  // Right half visibility (only shown after 50%)
  const rightHalfContainerStyle = useAnimatedStyle(() => ({
    opacity: progress.value > 0.5 ? 1 : 0,
  }));

  const a11yLabel = t('profile.completeness.a11y', {
    defaultValue: `Profile ${clampedPercentage} percent complete`,
    percentage: clampedPercentage,
  });

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={a11yLabel}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: clampedPercentage,
      }}
      testID="completeness-ring"
    >
      {/* Background track */}
      <View
        style={[
          styles.track,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: RING_STROKE_WIDTH,
          },
        ]}
      />

      {/* Left half clip container */}
      <View style={[styles.halfClip, { width: halfSize, height: size, left: 0 }]}>
        <Animated.View
          style={[
            styles.halfFill,
            {
              width: halfSize,
              height: size,
              borderTopLeftRadius: halfSize,
              borderBottomLeftRadius: halfSize,
              borderWidth: RING_STROKE_WIDTH,
              borderRightWidth: 0,
              left: 0,
              transformOrigin: 'right center',
            },
            leftHalfStyle,
          ]}
        />
      </View>

      {/* Right half clip container */}
      <Animated.View
        style={[
          styles.halfClip,
          { width: halfSize, height: size, right: 0 },
          rightHalfContainerStyle,
        ]}
      >
        <Animated.View
          style={[
            styles.halfFill,
            {
              width: halfSize,
              height: size,
              borderTopRightRadius: halfSize,
              borderBottomRightRadius: halfSize,
              borderWidth: RING_STROKE_WIDTH,
              borderLeftWidth: 0,
              right: 0,
              transformOrigin: 'left center',
            },
            rightHalfStyle,
          ]}
        />
      </Animated.View>

      {/* Center circle (background) */}
      <View
        style={[
          styles.center,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
          },
        ]}
      />

      {/* Percentage text */}
      <Text style={styles.percentageText}>{clampedPercentage}%</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    position: 'absolute',
    borderColor: COLORS.track,
  },
  halfClip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  halfFill: {
    position: 'absolute',
    borderColor: COLORS.accent,
  },
  center: {
    position: 'absolute',
    backgroundColor: COLORS.background,
  },
  percentageText: {
    position: 'absolute',
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
});

export default CompletenessRing;

/**
 * RadarSkeleton — Loading skeleton for the Radar screen initial data fetch.
 *
 * Shows animated placeholder shapes mimicking the map/list UI
 * to indicate loading state. Never shows a generic spinner.
 *
 * @requirements 12.5
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  skeletonBase: '#1F2833',
  skeletonHighlight: 'rgba(255, 255, 255, 0.06)',
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const SHIMMER_DURATION = 1200;
const CARD_HEIGHT = 80;
const CARD_BORDER_RADIUS = 12;
const CARD_COUNT = 5;
const CARD_GAP = 12;
const MAP_PLACEHOLDER_HEIGHT_RATIO = 0.5;
const TOGGLE_HEIGHT = 36;
const TOGGLE_WIDTH = 160;
const TOGGLE_BORDER_RADIUS = 18;

// ─── Component ───────────────────────────────────────────────────────────────

export function RadarSkeleton(): React.JSX.Element {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => animation.stop();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={styles.container} testID="radar-skeleton">
      {/* Toggle placeholder */}
      <View style={styles.toggleRow}>
        <Animated.View style={[styles.togglePlaceholder, { opacity }]} />
      </View>

      {/* Map area placeholder */}
      <Animated.View style={[styles.mapPlaceholder, { opacity }]} />

      {/* Card placeholders */}
      <View style={styles.cardsContainer}>
        {Array.from({ length: CARD_COUNT }, (_, index) => (
          <Animated.View
            key={`skeleton-card-${index}`}
            style={[styles.cardPlaceholder, { opacity }]}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
  },
  toggleRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  togglePlaceholder: {
    width: TOGGLE_WIDTH,
    height: TOGGLE_HEIGHT,
    borderRadius: TOGGLE_BORDER_RADIUS,
    backgroundColor: COLORS.skeletonBase,
  },
  mapPlaceholder: {
    flex: MAP_PLACEHOLDER_HEIGHT_RATIO,
    backgroundColor: COLORS.skeletonBase,
    borderRadius: CARD_BORDER_RADIUS,
    marginBottom: CARD_GAP,
  },
  cardsContainer: {
    gap: CARD_GAP,
  },
  cardPlaceholder: {
    height: CARD_HEIGHT,
    backgroundColor: COLORS.skeletonBase,
    borderRadius: CARD_BORDER_RADIUS,
  },
});

export default RadarSkeleton;

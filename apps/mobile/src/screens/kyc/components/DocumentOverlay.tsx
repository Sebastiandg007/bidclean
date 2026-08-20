/**
 * Camera overlay component showing correct document positioning frame.
 *
 * Renders a rectangular guide overlay on the camera view to help
 * users align their identity document. Border color animates to accent
 * when the document is correctly aligned.
 */

import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import type { DocumentOverlayProps } from '../kyc.types';
import {
  COLORS,
  DOCUMENT_ASPECT_RATIO,
  OVERLAY_WIDTH_RATIO,
  SPRING_CONFIG,
} from '../kyc.constants';

// ─── Layout Constants ────────────────────────────────────────────────────────

const BORDER_WIDTH = 3;
const BORDER_RADIUS = 12;
const CORNER_SIZE = 24;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Document positioning overlay for the camera view.
 *
 * @param props.isAligned - Whether the document is correctly positioned
 */
export function DocumentOverlay({ isAligned }: DocumentOverlayProps) {
  const { width: screenWidth } = useWindowDimensions();

  const frameWidth = screenWidth * OVERLAY_WIDTH_RATIO;
  const frameHeight = frameWidth / DOCUMENT_ASPECT_RATIO;

  const borderOpacity = useSharedValue(1);

  useEffect(() => {
    borderOpacity.value = withSpring(isAligned ? 1 : 0.6, SPRING_CONFIG);
  }, [isAligned, borderOpacity]);

  const frameAnimatedStyle = useAnimatedStyle(() => ({
    borderColor: isAligned ? COLORS.accent : COLORS.border,
    opacity: borderOpacity.value,
  }));

  return (
    <View
      style={styles.container}
      accessibilityLabel={
        isAligned ? 'Document aligned correctly' : 'Align document within frame'
      }
      accessibilityRole="image"
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.frame,
          { width: frameWidth, height: frameHeight },
          frameAnimatedStyle,
        ]}
      >
        {/* Corner indicators */}
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    borderWidth: BORDER_WIDTH,
    borderRadius: BORDER_RADIUS,
    borderColor: COLORS.border,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: COLORS.accent,
  },
  cornerTopLeft: {
    top: -BORDER_WIDTH,
    left: -BORDER_WIDTH,
    borderTopWidth: BORDER_WIDTH,
    borderLeftWidth: BORDER_WIDTH,
    borderTopLeftRadius: BORDER_RADIUS,
  },
  cornerTopRight: {
    top: -BORDER_WIDTH,
    right: -BORDER_WIDTH,
    borderTopWidth: BORDER_WIDTH,
    borderRightWidth: BORDER_WIDTH,
    borderTopRightRadius: BORDER_RADIUS,
  },
  cornerBottomLeft: {
    bottom: -BORDER_WIDTH,
    left: -BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderLeftWidth: BORDER_WIDTH,
    borderBottomLeftRadius: BORDER_RADIUS,
  },
  cornerBottomRight: {
    bottom: -BORDER_WIDTH,
    right: -BORDER_WIDTH,
    borderBottomWidth: BORDER_WIDTH,
    borderRightWidth: BORDER_WIDTH,
    borderBottomRightRadius: BORDER_RADIUS,
  },
});

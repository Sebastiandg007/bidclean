/**
 * Face-shaped overlay guiding selfie positioning.
 *
 * Renders an oval/face-shaped guide on the front camera view.
 * Provides visual feedback when a face is detected and warns
 * if multiple faces are in frame.
 */

import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { FaceOverlayProps } from '../kyc.types';
import { COLORS, SPRING_CONFIG } from '../kyc.constants';

// ─── Layout Constants ────────────────────────────────────────────────────────

const BORDER_WIDTH = 3;
const OVAL_WIDTH_RATIO = 0.6;
const OVAL_ASPECT_RATIO = 1.4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBorderColor(isFaceDetected: boolean, hasMultipleFaces: boolean): string {
  if (hasMultipleFaces) return COLORS.error;
  if (isFaceDetected) return COLORS.accent;
  return COLORS.border;
}

function getAccessibilityLabel(
  isFaceDetected: boolean,
  hasMultipleFaces: boolean,
  t: (key: string) => string,
): string {
  if (hasMultipleFaces) return t('selfie_capture.error_multiple_faces');
  if (isFaceDetected) return t('quality.good');
  return t('selfie_capture.guidance_face_position');
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Face positioning overlay for the selfie camera view.
 *
 * @param props.isFaceDetected - Whether a single face is detected
 * @param props.hasMultipleFaces - Whether multiple faces are detected (error)
 */
export function FaceOverlay({ isFaceDetected, hasMultipleFaces }: FaceOverlayProps) {
  const { t } = useTranslation('kyc');
  const { width: screenWidth } = useWindowDimensions();

  const ovalWidth = screenWidth * OVAL_WIDTH_RATIO;
  const ovalHeight = ovalWidth * OVAL_ASPECT_RATIO;

  const borderOpacity = useSharedValue(0.6);

  useEffect(() => {
    const targetOpacity = isFaceDetected || hasMultipleFaces ? 1 : 0.6;
    borderOpacity.value = withSpring(targetOpacity, SPRING_CONFIG);
  }, [isFaceDetected, hasMultipleFaces, borderOpacity]);

  const borderColor = getBorderColor(isFaceDetected, hasMultipleFaces);

  const ovalAnimatedStyle = useAnimatedStyle(() => ({
    opacity: borderOpacity.value,
  }));

  const accessibilityLabel = getAccessibilityLabel(isFaceDetected, hasMultipleFaces, t);

  return (
    <View
      style={styles.container}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.oval,
          {
            width: ovalWidth,
            height: ovalHeight,
            borderColor,
            borderRadius: ovalWidth / 2,
          },
          ovalAnimatedStyle,
        ]}
        testID="face-overlay-oval"
      />
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
  oval: {
    borderWidth: BORDER_WIDTH,
    borderColor: COLORS.border,
  },
});

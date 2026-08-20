/**
 * Real-time quality feedback component for camera capture.
 *
 * Displays animated banners indicating image quality issues
 * (blur, low light, document not visible) to help users capture
 * acceptable images on the first attempt.
 */

import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { QualityFeedbackProps, QualityFeedbackType } from '../kyc.types';
import { COLORS, FONT_SIZE, SPACING, SPRING_CONFIG } from '../kyc.constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FEEDBACK_I18N_MAP: Record<QualityFeedbackType, string> = {
  too_blurry: 'kyc:quality.too_blurry',
  low_light: 'kyc:quality.low_light',
  document_not_visible: 'kyc:quality.document_not_visible',
  hold_steady: 'kyc:quality.hold_steady',
  good: 'kyc:quality.good',
};

function getBackgroundColor(feedbackType: QualityFeedbackType): string {
  if (feedbackType === 'good') return COLORS.accent;
  if (feedbackType === 'hold_steady') return COLORS.warning;
  return COLORS.error;
}

function getTextColor(feedbackType: QualityFeedbackType): string {
  if (feedbackType === 'good' || feedbackType === 'hold_steady') {
    return COLORS.background;
  }
  return COLORS.textPrimary;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Animated quality feedback banner for camera screens.
 *
 * @param props.feedbackType - Current quality issue type
 * @param props.isVisible - Whether the feedback should be displayed
 */
export function QualityFeedback({ feedbackType, isVisible }: QualityFeedbackProps) {
  const { t } = useTranslation('kyc');
  const translateY = useSharedValue(50);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(isVisible ? 0 : 50, SPRING_CONFIG);
    opacity.value = withSpring(isVisible ? 1 : 0, SPRING_CONFIG);
  }, [isVisible, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const backgroundColor = getBackgroundColor(feedbackType);
  const textColor = getTextColor(feedbackType);
  const i18nKey = FEEDBACK_I18N_MAP[feedbackType];

  return (
    <Animated.View
      style={[styles.container, animatedStyle]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t(i18nKey)}
    >
      <View style={[styles.banner, { backgroundColor }]}>
        <Text style={[styles.text, { color: textColor }]}>
          {t(i18nKey)}
        </Text>
      </View>
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: SPACING.xxl * 3,
    left: SPACING.lg,
    right: SPACING.lg,
    alignItems: 'center',
  },
  banner: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
  },
  text: {
    fontSize: FONT_SIZE.feedback,
    fontWeight: '600',
    textAlign: 'center',
  },
});

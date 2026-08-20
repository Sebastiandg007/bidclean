/**
 * KYC status screen showing current verification state.
 *
 * Displays the KYC pipeline status (processing, verified, rejected)
 * with appropriate messaging and a retry button when rejected.
 * Polls the server for status updates while in PROCESSING state.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import type { KycStatus, KycStatusScreenProps } from './kyc.types';
import { useKyc } from './useKyc';
import { COLORS, FONT_SIZE, SPACING, SPRING_CONFIG } from './kyc.constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const ANIMATION_DELAY_MS = 200;
const POLLING_INTERVAL_MS = 5000;
const ICON_SIZE = 80;

/** States considered incomplete (user needs to upload documents) */
const INCOMPLETE_STATES: KycStatus[] = [
  'NOT_STARTED',
  'DOCUMENT_UPLOADED',
  'SELFIE_UPLOADED',
];

// ─── Helper: Determine Status Category ───────────────────────────────────────

type StatusCategory = 'incomplete' | 'processing' | 'verified' | 'rejected';

function getStatusCategory(status: KycStatus): StatusCategory {
  if (INCOMPLETE_STATES.includes(status)) return 'incomplete';
  if (status === 'PROCESSING') return 'processing';
  if (status === 'VERIFIED') return 'verified';
  return 'rejected';
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function StatusIcon({ category }: { category: StatusCategory }) {
  const iconMap: Record<StatusCategory, string> = {
    incomplete: '📄',
    processing: '',
    verified: '✓',
    rejected: '✕',
  };

  if (category === 'processing') {
    return (
      <View
        style={styles.iconContainer}
        accessibilityLabel={category}
      >
        <ActivityIndicator
          size="large"
          color={COLORS.accent}
          testID="processing-indicator"
        />
      </View>
    );
  }

  const colorMap: Record<StatusCategory, string> = {
    incomplete: COLORS.warning,
    processing: COLORS.accent,
    verified: COLORS.accent,
    rejected: COLORS.error,
  };

  return (
    <View
      style={[styles.iconContainer, { borderColor: colorMap[category] }]}
      accessibilityLabel={category}
    >
      <Text style={[styles.iconText, { color: colorMap[category] }]}>
        {iconMap[category]}
      </Text>
    </View>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Status display screen for KYC verification progress.
 *
 * Shows different UI states based on the current KYC status:
 * - Incomplete: Banner/CTA to start or continue verification
 * - Processing: Animated activity indicator with progress message
 * - Verified: Success state with checkmark
 * - Rejected: Failure reason with retry button
 *
 * @param props.onRetry - Called when user taps retry after rejection
 * @param props.onVerified - Called when verification completes successfully
 */
export function KycStatusScreen({ onRetry, onVerified }: KycStatusScreenProps) {
  const { t } = useTranslation('kyc');
  const { status, refreshStatus, retry, attemptNumber, statusResponse } = useKyc();
  const hasCalledVerified = useRef(false);

  // ─── Animations ──────────────────────────────────────────────────────

  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(20);

  useEffect(() => {
    contentOpacity.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    contentTranslateY.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(0, SPRING_CONFIG),
    );
  }, [contentOpacity, contentTranslateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  // ─── Polling while PROCESSING ────────────────────────────────────────

  useEffect(() => {
    if (status !== 'PROCESSING') return;

    const interval = setInterval(() => {
      refreshStatus();
    }, POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [status, refreshStatus]);

  // ─── Call onVerified when status transitions ─────────────────────────

  useEffect(() => {
    if (status === 'VERIFIED' && !hasCalledVerified.current) {
      hasCalledVerified.current = true;
      onVerified?.();
    }
  }, [status, onVerified]);

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleRetry = useCallback(async () => {
    await retry();
    onRetry?.();
  }, [retry, onRetry]);

  // ─── Render ──────────────────────────────────────────────────────────

  const category = getStatusCategory(status);
  const rejectionReason = statusResponse?.rejectionReason ?? '';

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, animatedStyle]}>
        {/* Title */}
        <Text
          style={styles.screenTitle}
          accessibilityRole="header"
        >
          {t('status.title')}
        </Text>

        {/* Status Icon */}
        <StatusIcon category={category} />

        {/* Status Message */}
        <StatusMessage
          category={category}
          rejectionReason={rejectionReason}
          t={t}
        />

        {/* Attempt Label */}
        {attemptNumber > 1 && (
          <Text style={styles.attemptLabel}>
            {t('status.attempt_label', { number: attemptNumber })}
          </Text>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          {category === 'rejected' && (
            <Pressable
              style={styles.retryButton}
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel={t('status.retry_button')}
              testID="retry-button"
            >
              <Text style={styles.retryButtonText}>
                {t('status.retry_button')}
              </Text>
            </Pressable>
          )}

          {category === 'incomplete' && (
            <Pressable
              style={styles.ctaButton}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={t('status.start_verification')}
              testID="start-verification-button"
            >
              <Text style={styles.ctaButtonText}>
                {t('status.start_verification')}
              </Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── StatusMessage Sub-Component ─────────────────────────────────────────────

interface StatusMessageProps {
  category: StatusCategory;
  rejectionReason: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function StatusMessage({ category, rejectionReason, t }: StatusMessageProps) {
  switch (category) {
    case 'processing':
      return (
        <View style={styles.messageContainer}>
          <Text
            style={styles.statusTitle}
            accessibilityRole="text"
            accessibilityLabel={t('status.processing')}
          >
            {t('status.processing')}
          </Text>
          <Text style={styles.statusSubtitle}>
            {t('status.processing_subtitle')}
          </Text>
        </View>
      );

    case 'verified':
      return (
        <View style={styles.messageContainer}>
          <Text
            style={styles.statusTitle}
            accessibilityRole="text"
            accessibilityLabel={t('status.verified')}
          >
            {t('status.verified')}
          </Text>
          <Text style={styles.statusSubtitle}>
            {t('status.verified_subtitle')}
          </Text>
        </View>
      );

    case 'rejected':
      return (
        <View style={styles.messageContainer}>
          <Text
            style={styles.statusTitle}
            accessibilityRole="text"
            accessibilityLabel={t('status.rejected')}
          >
            {t('status.rejected')}
          </Text>
          <View style={styles.rejectionCard}>
            <Text style={styles.rejectionText}>
              {t('status.rejected_subtitle', { reason: rejectionReason })}
            </Text>
          </View>
        </View>
      );

    case 'incomplete':
    default:
      return (
        <View style={styles.messageContainer}>
          <Text
            style={styles.statusTitle}
            accessibilityRole="text"
            accessibilityLabel={t('status.incomplete_title')}
          >
            {t('status.incomplete_title')}
          </Text>
          <Text style={styles.statusSubtitle}>
            {t('status.incomplete_subtitle')}
          </Text>
        </View>
      );
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  screenTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xxl,
  },
  iconContainer: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    borderWidth: 3,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  iconText: {
    fontSize: 36,
    fontWeight: '700',
  },
  messageContainer: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  statusTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  statusSubtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  rejectionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.error,
  },
  rejectionText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  attemptLabel: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  actionsContainer: {
    width: '100%',
    marginTop: SPACING.xl,
  },
  retryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  ctaButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  ctaButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
});

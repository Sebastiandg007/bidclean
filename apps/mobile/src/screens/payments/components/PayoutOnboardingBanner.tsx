/**
 * PayoutOnboardingBanner — shown to a Cleaner while payouts are not yet enabled.
 * Prompts them to finish Stripe onboarding so held funds can be released.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  accentText: '#0B0C10',
  title: '#FFFFFF',
  body: 'rgba(255, 255, 255, 0.7)',
} as const;

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { title: 15, body: 13, button: 14 } as const;
const RADIUS = 12;

export interface PayoutOnboardingBannerProps {
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

export function PayoutOnboardingBanner({
  onPress,
  disabled = false,
  testID,
}: PayoutOnboardingBannerProps): React.JSX.Element {
  const { t } = useTranslation('payments');

  return (
    <View style={styles.card} testID={testID ?? 'payout-onboarding-banner'}>
      <Text style={styles.title}>{t('onboarding.bannerTitle')}</Text>
      <Text style={styles.body}>{t('onboarding.bannerBody')}</Text>
      <TouchableOpacity
        style={[styles.button, disabled && styles.buttonDisabled]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={disabled ? 1 : 0.7}
        accessibilityRole="button"
        testID="payout-onboarding-banner-button"
      >
        <Text style={styles.buttonText}>{t('onboarding.continueButton')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.title,
  },
  body: {
    fontSize: FONT_SIZE.body,
    color: COLORS.body,
  },
  button: {
    marginTop: SPACING.sm,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS,
    backgroundColor: COLORS.accent,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.accentText,
  },
});

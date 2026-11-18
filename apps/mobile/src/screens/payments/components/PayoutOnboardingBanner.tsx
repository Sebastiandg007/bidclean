/**
 * PayoutOnboardingBanner — shown to a Cleaner while payouts are not yet enabled.
 * Prompts them to finish Stripe onboarding so held funds can be released.
 */

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../../theme';

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
  const styles = useStyles();

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

const useStyles = makeStyles((theme) => ({
  card: {
    backgroundColor: theme.surface,
    borderRadius: RADIUS,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  body: {
    fontSize: FONT_SIZE.body,
    color: theme.textSecondary,
  },
  button: {
    marginTop: SPACING.sm,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS,
    backgroundColor: theme.accent,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: theme.onAccent,
  },
}));

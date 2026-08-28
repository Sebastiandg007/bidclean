/**
 * CleanerPayoutOnboardingScreen — opens the Stripe Express onboarding link in the
 * system browser and reflects the returned account status. Shows a banner while
 * payouts are not yet enabled. Never touches financial credentials directly.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';

import { usePaymentsStore } from './usePayments';
import { PayoutOnboardingBanner } from './components/PayoutOnboardingBanner';

const COLORS = {
  bg: '#0B0C10',
  title: '#FFFFFF',
  body: 'rgba(255, 255, 255, 0.7)',
  accent: '#00F5D4',
  accentText: '#0B0C10',
} as const;

const SPACING = { sm: 8, md: 16, lg: 24 } as const;
const FONT_SIZE = { title: 22, body: 14, button: 15 } as const;

export function CleanerPayoutOnboardingScreen(): React.JSX.Element {
  const { t } = useTranslation('payments');
  const accountStatus = usePaymentsStore((s) => s.accountStatus);
  const isSubmitting = usePaymentsStore((s) => s.isSubmitting);
  const refreshAccountStatus = usePaymentsStore((s) => s.refreshAccountStatus);
  const startOnboarding = usePaymentsStore((s) => s.startOnboarding);
  const needsOnboarding = usePaymentsStore((s) => s.needsPayoutOnboarding);

  useEffect(() => {
    void refreshAccountStatus();
  }, [refreshAccountStatus]);

  const openOnboarding = async (): Promise<void> => {
    const result = await startOnboarding();
    if (result) {
      await WebBrowser.openBrowserAsync(result.onboardingUrl);
      // Re-check status when the user returns from the hosted flow.
      await refreshAccountStatus();
    }
  };

  const payoutsEnabled = accountStatus?.payoutsEnabled === true;

  return (
    <View style={styles.screen} testID="cleaner-payout-onboarding-screen">
      <Text style={styles.title}>{t('onboarding.title')}</Text>
      <Text style={styles.body}>{t('onboarding.subtitle')}</Text>

      {payoutsEnabled ? (
        <Text style={styles.completed} testID="onboarding-completed">
          {t('onboarding.completed')}
        </Text>
      ) : (
        <>
          {accountStatus?.hasAccount && (
            <PayoutOnboardingBanner onPress={() => void openOnboarding()} disabled={isSubmitting} />
          )}
          <TouchableOpacity
            style={[styles.button, isSubmitting && styles.buttonDisabled]}
            onPress={() => void openOnboarding()}
            disabled={isSubmitting}
            activeOpacity={isSubmitting ? 1 : 0.7}
            accessibilityRole="button"
            testID="start-onboarding-button"
          >
            <Text style={styles.buttonText}>
              {needsOnboarding() ? t('onboarding.startButton') : t('onboarding.continueButton')}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
    padding: SPACING.md,
    gap: SPACING.md,
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
  completed: {
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    color: COLORS.accent,
  },
  button: {
    marginTop: SPACING.sm,
    height: 52,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.accentText,
  },
});

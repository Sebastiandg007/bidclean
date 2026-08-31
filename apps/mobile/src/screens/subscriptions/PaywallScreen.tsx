/**
 * PaywallScreen — presents the RevenueCat server-driven paywall (Paywalls V2) for the
 * role-appropriate offering (Cleaner PRO for Cleaners, Host PRO for Hosts), resolved from the
 * active role. Purchase/restore/cancel/error are handled with i18n messaging; on completion the
 * subscription store refreshes `/subscriptions/me` so the client converges to the
 * server-authoritative mirror. The client never grants entitlements.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Purchases, { type PurchasesOffering } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';

import { useSubscriptionStore } from './useSubscription';
import { RC_OFFERING_IDS, SUBSCRIPTIONS_I18N_KEYS } from './subscriptions.constants';
import { SubscriberRole } from './subscriptions.types';

const COLORS = { bg: '#0B0C10', title: '#FFFFFF', error: '#FF6B6B' } as const;

export interface PaywallScreenProps {
  /** The active role; selects the role-appropriate offering. */
  role: SubscriberRole;
  /** Called when the paywall is dismissed (purchased, restored, or closed). */
  onDismiss?: () => void;
}

export function PaywallScreen({ role, onDismiss }: PaywallScreenProps): React.JSX.Element {
  const { t } = useTranslation('subscriptions');
  const refreshServerView = useSubscriptionStore((s) => s.refreshServerView);

  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOffering(): Promise<void> {
      try {
        const offerings = await Purchases.getOfferings();
        const resolved = offerings.all[RC_OFFERING_IDS[role]] ?? offerings.current ?? null;
        if (isMounted) {
          setOffering(resolved);
          setErrorKey(resolved ? null : SUBSCRIPTIONS_I18N_KEYS.ERROR_OFFERING_UNAVAILABLE);
          setIsLoading(false);
        }
      } catch {
        if (isMounted) {
          setErrorKey(SUBSCRIPTIONS_I18N_KEYS.ERROR_OFFERING_UNAVAILABLE);
          setIsLoading(false);
        }
      }
    }

    void loadOffering();
    return () => {
      isMounted = false;
    };
  }, [role]);

  if (isLoading) {
    return (
      <View style={styles.centered} testID="paywall-loading">
        <ActivityIndicator color={COLORS.title} />
      </View>
    );
  }

  if (errorKey || !offering) {
    return (
      <View style={styles.centered} testID="paywall-error">
        <Text style={styles.error}>{t(errorKey ?? SUBSCRIPTIONS_I18N_KEYS.ERROR_OFFERING_UNAVAILABLE)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="paywall-screen">
      <RevenueCatUI.Paywall
        options={{ offering, displayCloseButton: true }}
        onPurchaseCompleted={() => {
          void refreshServerView().finally(() => onDismiss?.());
        }}
        onRestoreCompleted={() => {
          void refreshServerView().finally(() => onDismiss?.());
        }}
        onPurchaseCancelled={() => onDismiss?.()}
        onDismiss={() => onDismiss?.()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
    padding: 24,
  },
  error: {
    color: COLORS.error,
    fontSize: 15,
    textAlign: 'center',
  },
});

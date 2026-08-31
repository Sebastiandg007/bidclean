/**
 * HostPaymentMethodScreen — lets the Host add a payment method via the Stripe
 * Payment Sheet. Raw card data never reaches our servers or JS (PCI SAQ-A): the
 * Stripe SDK collects and tokenizes it. The publishable key comes from env.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { StripeProvider, useStripe } from '@stripe/stripe-react-native';

import { STRIPE_PUBLISHABLE_KEY } from './payments.constants';

const COLORS = {
  bg: '#0B0C10',
  title: '#FFFFFF',
  body: 'rgba(255, 255, 255, 0.7)',
  accent: '#00F5D4',
  accentText: '#0B0C10',
  error: '#FF5C5C',
  success: '#00F5D4',
} as const;

const SPACING = { sm: 8, md: 16 } as const;
const FONT_SIZE = { title: 22, body: 14, button: 15 } as const;

/** Fetches a Payment Sheet setup from the backend (client secret + customer). */
export interface PaymentSheetParams {
  setupIntentClientSecret: string;
  customerId: string;
  customerEphemeralKeySecret: string;
}

export interface HostPaymentMethodScreenProps {
  /** Resolves the params needed to initialize the Payment Sheet (from the API). */
  fetchPaymentSheetParams: () => Promise<PaymentSheetParams>;
}

function HostPaymentMethodInner({
  fetchPaymentSheetParams,
}: HostPaymentMethodScreenProps): React.JSX.Element {
  const { t } = useTranslation('payments');
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addPaymentMethod = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const params = await fetchPaymentSheetParams();
      const init = await initPaymentSheet({
        merchantDisplayName: 'BidClean',
        customerId: params.customerId,
        customerEphemeralKeySecret: params.customerEphemeralKeySecret,
        setupIntentClientSecret: params.setupIntentClientSecret,
      });
      if (init.error) {
        setError(t('hostPaymentMethod.error'));
        return;
      }
      const result = await presentPaymentSheet();
      if (result.error) {
        setError(t('hostPaymentMethod.error'));
        return;
      }
      setSaved(true);
    } catch {
      setError(t('hostPaymentMethod.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen} testID="host-payment-method-screen">
      <Text style={styles.title}>{t('hostPaymentMethod.title')}</Text>
      <Text style={styles.body}>{t('hostPaymentMethod.subtitle')}</Text>

      {saved ? (
        <Text style={styles.success} testID="card-saved">
          {t('hostPaymentMethod.cardSaved')}
        </Text>
      ) : (
        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void addPaymentMethod()}
          disabled={busy}
          activeOpacity={busy ? 1 : 0.7}
          accessibilityRole="button"
          testID="add-card-button"
        >
          <Text style={styles.buttonText}>{t('hostPaymentMethod.addCard')}</Text>
        </TouchableOpacity>
      )}

      {error && (
        <Text style={styles.error} testID="payment-method-error">
          {error}
        </Text>
      )}
    </View>
  );
}

export function HostPaymentMethodScreen(props: HostPaymentMethodScreenProps): React.JSX.Element {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      <HostPaymentMethodInner {...props} />
    </StripeProvider>
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
  success: {
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    color: COLORS.success,
  },
  error: {
    fontSize: FONT_SIZE.body,
    color: COLORS.error,
  },
});

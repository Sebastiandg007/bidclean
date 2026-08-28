/**
 * PayoutPreview — shows the Cleaner payout and Host total for a given price,
 * formatted per locale and the offer currency. Presentation only.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../negotiation.format';

const COLORS = {
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  accent: '#00F5D4',
} as const;

const SPACING = { xs: 4, sm: 8 } as const;
const FONT_SIZE = { label: 13, value: 15 } as const;

export interface PayoutPreviewProps {
  cleanerPayoutCents: number;
  hostTotalCents: number;
  currency: string;
  /** Which perspective to emphasize */
  perspective: 'cleaner' | 'host';
}

export function PayoutPreview({
  cleanerPayoutCents,
  hostTotalCents,
  currency,
  perspective,
}: PayoutPreviewProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');

  const payout = formatMoney(cleanerPayoutCents, currency);
  const total = formatMoney(hostTotalCents, currency);

  return (
    <View style={styles.container} testID="payout-preview">
      {perspective === 'cleaner' ? (
        <Text style={styles.value}>{t('counterInput.livePayout', { payout })}</Text>
      ) : (
        <>
          <Text style={styles.value}>{t('counterInput.hostTotal', { total })}</Text>
          <Text style={styles.secondary}>{t('host.cleanerPayout', { payout })}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: SPACING.xs,
  },
  value: {
    fontSize: FONT_SIZE.value,
    fontWeight: '600',
    color: COLORS.accent,
  },
  secondary: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
  },
});

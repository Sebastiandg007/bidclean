/**
 * PriceBreakdown — Displays offered price, fee/commission, and total/payout.
 *
 * Accepts priceCents and role to show the appropriate view:
 * - Host view: offeredPrice + serviceFee = hostTotal
 * - Cleaner view: offeredPrice - commission = cleanerPayout
 *
 * Formats currency with locale and updates live as price changes.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, SPACING, FONT_SIZE } from '../offers.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceBreakdownProps {
  /** Price in cents set by the Host */
  offeredPriceCents: number;
  /** Currency code (e.g., "USD", "COP") */
  currency: string;
  /** Host service fee in cents */
  hostServiceFeeCents: number;
  /** Host total (offeredPrice + fee) in cents */
  hostTotalCents: number;
  /** Fee rate in basis points (e.g., 1000 = 10%) */
  hostServiceFeeRateBps?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CENTS_DIVISOR = 100;
const BPS_DIVISOR = 100;
const BORDER_RADIUS = 12;
const DIVIDER_HEIGHT = 1;
const LETTER_SPACING = 0.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats cents to a currency string (e.g., 5500 → "$55.00").
 * Uses Intl.NumberFormat for locale-aware formatting.
 */
function formatCurrency(cents: number, currency: string): string {
  const amount = cents / CENTS_DIVISOR;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PriceBreakdown({
  offeredPriceCents,
  currency,
  hostServiceFeeCents,
  hostTotalCents,
  hostServiceFeeRateBps,
}: PriceBreakdownProps): React.JSX.Element {
  const { t } = useTranslation();

  const formattedPrice = useMemo(
    () => formatCurrency(offeredPriceCents, currency),
    [offeredPriceCents, currency],
  );

  const formattedFee = useMemo(
    () => formatCurrency(hostServiceFeeCents, currency),
    [hostServiceFeeCents, currency],
  );

  const formattedTotal = useMemo(
    () => formatCurrency(hostTotalCents, currency),
    [hostTotalCents, currency],
  );

  const feePercentage = hostServiceFeeRateBps
    ? `(${(hostServiceFeeRateBps / BPS_DIVISOR).toFixed(0)}%)`
    : '';

  return (
    <View
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={t('offers.confirmation.priceBreakdown.a11yLabel')}
      testID="price-breakdown"
    >
      <Text style={styles.title}>
        {t('offers.confirmation.priceBreakdown.title')}
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>
          {t('offers.confirmation.priceBreakdown.offeredPrice')}
        </Text>
        <Text style={styles.value}>{formattedPrice}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>
          {t('offers.confirmation.priceBreakdown.serviceFee')} {feePercentage}
        </Text>
        <Text style={styles.valueFee}>+{formattedFee}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.totalLabel}>
          {t('offers.confirmation.priceBreakdown.total')}
        </Text>
        <Text style={styles.totalValue}>{formattedTotal}</Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS,
    padding: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: LETTER_SPACING,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  label: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  value: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  valueFee: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.warning,
  },
  divider: {
    height: DIVIDER_HEIGHT,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
  totalLabel: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  totalValue: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.accent,
  },
});

export default PriceBreakdown;

/**
 * CounterofferInput — price entry with live payout preview and Base Price
 * deviation-bounds guard. Prevents submitting a price outside the allowed range
 * (the backend remains authoritative).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../negotiation.format';
import { getDeviationRange, isWithinDeviationBounds } from '../negotiation.constants';
import { PayoutPreview } from './PayoutPreview';
import { makeStyles, useTheme } from '../../../theme';

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { label: 13, input: 20, helper: 12, button: 16 } as const;
const RADIUS = 12;
const BUTTON_HEIGHT = 48;
const CENTS_PER_UNIT = 100;

export interface CounterofferInputProps {
  /** Immutable Base Price used for the deviation bounds */
  basePriceCents: number;
  currency: string;
  hostFeeRateBps: number;
  cleanerRateBps: number;
  perspective: 'cleaner' | 'host';
  submitLabel: string;
  disabled?: boolean;
  onSubmit: (priceCents: number) => void;
}

export function CounterofferInput({
  basePriceCents,
  currency,
  hostFeeRateBps,
  cleanerRateBps,
  perspective,
  submitLabel,
  disabled = false,
  onSubmit,
}: CounterofferInputProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');
  const styles = useStyles();
  const { theme } = useTheme();
  const [text, setText] = useState('');

  const range = useMemo(() => getDeviationRange(basePriceCents), [basePriceCents]);

  const priceCents = useMemo(() => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed * CENTS_PER_UNIT);
  }, [text]);

  const withinBounds = priceCents !== null && isWithinDeviationBounds(basePriceCents, priceCents);

  const breakdown = useMemo(() => {
    if (priceCents === null) {
      return null;
    }
    const BPS_DIVISOR = 10000;
    const hostFee = Math.trunc((priceCents * hostFeeRateBps) / BPS_DIVISOR);
    const cleanerCommission = Math.trunc((priceCents * cleanerRateBps) / BPS_DIVISOR);
    return {
      cleanerPayoutCents: priceCents - cleanerCommission,
      hostTotalCents: priceCents + hostFee,
    };
  }, [priceCents, hostFeeRateBps, cleanerRateBps]);

  const canSubmit = !disabled && priceCents !== null && withinBounds;

  const handleSubmit = useCallback(() => {
    if (priceCents !== null && withinBounds) {
      onSubmit(priceCents);
    }
  }, [priceCents, withinBounds, onSubmit]);

  return (
    <View style={styles.container} testID="counteroffer-input">
      <Text style={styles.label}>{t('counterInput.label')}</Text>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        placeholder={t('counterInput.placeholder')}
        placeholderTextColor={theme.textMuted}
        editable={!disabled}
        testID="counteroffer-price-input"
      />

      <Text style={styles.helper}>
        {t('counterInput.allowedRange', {
          min: formatMoney(range.minPriceCents, currency),
          max: formatMoney(range.maxPriceCents, currency),
        })}
      </Text>

      {priceCents !== null && !withinBounds && (
        <Text style={styles.error} testID="counteroffer-out-of-range">
          {t('counterInput.outOfRange', {
            min: formatMoney(range.minPriceCents, currency),
            max: formatMoney(range.maxPriceCents, currency),
          })}
        </Text>
      )}

      {breakdown !== null && withinBounds && (
        <PayoutPreview
          cleanerPayoutCents={breakdown.cleanerPayoutCents}
          hostTotalCents={breakdown.hostTotalCents}
          currency={currency}
          perspective={perspective}
        />
      )}

      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        activeOpacity={canSubmit ? 0.7 : 1}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        testID="counteroffer-submit"
      >
        <Text style={styles.buttonText}>{submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  container: {
    gap: SPACING.sm,
    backgroundColor: theme.surface,
    borderRadius: RADIUS,
    padding: SPACING.md,
  },
  label: {
    fontSize: FONT_SIZE.label,
    color: theme.textSecondary,
  },
  input: {
    fontSize: FONT_SIZE.input,
    fontWeight: '700',
    color: theme.textPrimary,
    backgroundColor: theme.surfaceElevated,
    borderRadius: RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  helper: {
    fontSize: FONT_SIZE.helper,
    color: theme.textSecondary,
  },
  error: {
    fontSize: FONT_SIZE.helper,
    color: theme.danger,
  },
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: RADIUS,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  buttonDisabled: {
    backgroundColor: theme.surfaceElevated,
  },
  buttonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: theme.onAccent,
  },
}));

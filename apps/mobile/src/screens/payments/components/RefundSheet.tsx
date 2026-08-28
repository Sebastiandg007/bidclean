/**
 * RefundSheet — Host full/partial refund entry. Mirrors the refundable ceiling for
 * client-side pre-validation (the server remains authoritative). A blank amount means
 * a full refund of the remaining amount.
 */

import React, { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../payments.format';

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  accentText: '#0B0C10',
  title: '#FFFFFF',
  body: 'rgba(255, 255, 255, 0.7)',
  inputBg: '#0B0C10',
  inputText: '#FFFFFF',
  disabled: 'rgba(0, 245, 212, 0.3)',
} as const;

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { title: 16, body: 13, input: 18, button: 15 } as const;
const RADIUS = 12;
const CENTS_PER_UNIT = 100;

export interface RefundSheetProps {
  /** Remaining refundable amount in cents (host_total - already refunded) */
  refundableCents: number;
  currency: string;
  submitting?: boolean;
  /** Called with an amount in cents, or undefined for a full refund */
  onSubmit: (amountCents?: number) => void;
  testID?: string;
}

export function RefundSheet({
  refundableCents,
  currency,
  submitting = false,
  onSubmit,
  testID,
}: RefundSheetProps): React.JSX.Element {
  const { t } = useTranslation('payments');
  const [isFull, setIsFull] = useState(true);
  const [amountText, setAmountText] = useState('');

  const parsedCents = parseAmountToCents(amountText);
  const partialValid =
    parsedCents !== null && parsedCents > 0 && parsedCents <= refundableCents;
  const canSubmit = !submitting && (isFull || partialValid);

  const handleSubmit = (): void => {
    if (!canSubmit) {
      return;
    }
    onSubmit(isFull ? undefined : parsedCents ?? undefined);
  };

  return (
    <View style={styles.card} testID={testID ?? 'refund-sheet'}>
      <Text style={styles.title}>{t('refund.title')}</Text>
      <Text style={styles.body}>
        {t('refund.remaining', { amount: formatMoney(refundableCents, currency) })}
      </Text>

      <View style={styles.row}>
        <Text style={styles.body}>{t('refund.fullRefund')}</Text>
        <Switch
          value={isFull}
          onValueChange={setIsFull}
          testID="refund-sheet-full-toggle"
        />
      </View>

      {!isFull && (
        <View style={styles.field}>
          <Text style={styles.body}>{t('refund.amountLabel')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0.00"
            placeholderTextColor={COLORS.body}
            testID="refund-sheet-amount-input"
          />
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        activeOpacity={canSubmit ? 0.7 : 1}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        testID="refund-sheet-submit"
      >
        <Text style={styles.buttonText}>{t('refund.submit')}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Parse a decimal currency string into integer cents, or null if invalid. */
function parseAmountToCents(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * CENTS_PER_UNIT);
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  field: {
    gap: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZE.input,
    color: COLORS.inputText,
  },
  button: {
    marginTop: SPACING.sm,
    height: 48,
    borderRadius: RADIUS,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  buttonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.accentText,
  },
});

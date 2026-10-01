/**
 * PaymentStatusScreen — shows a payment's three orthogonal statuses (payment, payout,
 * dispute), the money breakdown per locale + currency, a dispute banner while a
 * dispute is open, and a Host refund entry. Server-authoritative: it renders what
 * usePayments fetched.
 */

import React, { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../theme';
import { usePaymentsStore } from './usePayments';
import { formatMoney } from './payments.format';
import { PaymentStatusBadge } from './components/PaymentStatusBadge';
import { DisputeBanner } from './components/DisputeBanner';
import { RefundSheet } from './components/RefundSheet';
import {
  disputeLabelKey,
  disputeTone,
  paymentLabelKey,
  paymentTone,
  payoutLabelKey,
  payoutTone,
} from './payments.status-map';

const SPACING = { sm: 8, md: 16, lg: 24 } as const;
const FONT_SIZE = { title: 22, label: 13, amount: 16 } as const;

export interface PaymentStatusScreenProps {
  offerId: string;
  /** Whether the current user is the Host (enables the refund entry). */
  isHost: boolean;
}

export function PaymentStatusScreen({
  offerId,
  isHost,
}: PaymentStatusScreenProps): React.JSX.Element {
  const { t } = useTranslation('payments');
  const styles = useStyles();
  const payment = usePaymentsStore((s) => s.paymentByOffer.get(offerId));
  const fetchPayment = usePaymentsStore((s) => s.fetchPayment);
  const requestRefund = usePaymentsStore((s) => s.requestRefund);
  const isSubmitting = usePaymentsStore((s) => s.isSubmitting);

  useEffect(() => {
    void fetchPayment(offerId);
  }, [offerId, fetchPayment]);

  if (!payment) {
    return (
      <View style={styles.screen} testID="payment-status-screen">
        <Text style={styles.label}>{t('status.title')}</Text>
      </View>
    );
  }

  const { breakdown } = payment;
  const refundableCents = breakdown.hostTotalCents - breakdown.refundedAmountCents;
  const canRefund =
    isHost &&
    payment.disputeStatus !== 'OPEN' &&
    refundableCents > 0 &&
    payment.paymentStatus !== 'REFUNDED';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="payment-status-screen">
      <Text style={styles.title}>{t('status.title')}</Text>

      {payment.disputeStatus === 'OPEN' && <DisputeBanner />}

      <View style={styles.card}>
        <StatusRow
          label={t('status.paymentLabel')}
          labelKey={paymentLabelKey(payment.paymentStatus)}
          tone={paymentTone(payment.paymentStatus)}
          testID="payment-status-row"
        />
        <StatusRow
          label={t('status.payoutLabel')}
          labelKey={payoutLabelKey(payment.payoutStatus)}
          tone={payoutTone(payment.payoutStatus)}
          testID="payout-status-row"
        />
        <StatusRow
          label={t('status.disputeLabel')}
          labelKey={disputeLabelKey(payment.disputeStatus)}
          tone={disputeTone(payment.disputeStatus)}
          testID="dispute-status-row"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.amount}>
          {isHost
            ? t('status.hostTotal', { total: formatMoney(breakdown.hostTotalCents, breakdown.currency) })
            : t('status.cleanerPayout', {
                payout: formatMoney(breakdown.cleanerPayoutCents, breakdown.currency),
              })}
        </Text>
        {breakdown.refundedAmountCents > 0 && (
          <Text style={styles.label}>
            {t('status.refunded', {
              amount: formatMoney(breakdown.refundedAmountCents, breakdown.currency),
            })}
          </Text>
        )}
      </View>

      {canRefund && (
        <RefundSheet
          refundableCents={refundableCents}
          currency={breakdown.currency}
          submitting={isSubmitting}
          onSubmit={(amountCents) => {
            void requestRefund(offerId, amountCents);
          }}
        />
      )}
    </ScrollView>
  );
}

interface StatusRowProps {
  label: string;
  labelKey: string;
  tone: ReturnType<typeof paymentTone>;
  testID: string;
}

function StatusRow({ label, labelKey, tone, testID }: StatusRowProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <PaymentStatusBadge labelKey={labelKey} tone={tone} />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    padding: SPACING.md,
    gap: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: FONT_SIZE.label,
    color: theme.textSecondary,
  },
  amount: {
    fontSize: FONT_SIZE.amount,
    fontWeight: '600',
    color: theme.textPrimary,
  },
}));

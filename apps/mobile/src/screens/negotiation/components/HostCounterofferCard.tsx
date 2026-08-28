/**
 * HostCounterofferCard — one incoming Cleaner counteroffer in the Host inbox,
 * with Accept / Reject / Counter actions and an inline counter-back input.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { HostInboxItem } from '../negotiation.types';
import { formatMoney } from '../negotiation.format';
import { ProposalStatusBadge } from './ProposalStatusBadge';
import { CounterBackInput } from './CounterBackInput';

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  reject: '#FF6B6B',
  outline: 'rgba(255, 255, 255, 0.2)',
} as const;

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { title: 16, body: 14, button: 14 } as const;
const RADIUS = 12;

export interface HostCounterofferCardProps {
  item: HostInboxItem;
  /** Base price (from the Cleaner proposal's offer) for counter-back bounds */
  basePriceCents: number;
  hostFeeRateBps: number;
  cleanerRateBps: number;
  disabled?: boolean;
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onCounter: (proposalId: string, priceCents: number) => void;
}

export function HostCounterofferCard({
  item,
  basePriceCents,
  hostFeeRateBps,
  cleanerRateBps,
  disabled = false,
  onAccept,
  onReject,
  onCounter,
}: HostCounterofferCardProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');
  const [isCountering, setIsCountering] = useState(false);

  const { proposal, cleaner, propertyName } = item;

  const handleCounterSubmit = useCallback(
    (priceCents: number) => {
      onCounter(proposal.id, priceCents);
      setIsCountering(false);
    },
    [onCounter, proposal.id],
  );

  return (
    <View style={styles.card} testID={`host-counteroffer-${proposal.id}`}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {propertyName ?? cleaner.fullName ?? cleaner.cleanerId}
        </Text>
        <ProposalStatusBadge status={proposal.status} />
      </View>

      <Text style={styles.body}>
        {t('host.proposedPrice', { price: formatMoney(proposal.proposedPriceCents, proposal.currency) })}
      </Text>
      <Text style={styles.secondary}>
        {t('host.yourTotal', { total: formatMoney(proposal.hostTotalCents, proposal.currency) })}
      </Text>
      <Text style={styles.secondary}>
        {t('host.cleanerPayout', { payout: formatMoney(proposal.cleanerPayoutCents, proposal.currency) })}
      </Text>

      {!isCountering ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.acceptButton]}
            onPress={() => onAccept(proposal.id)}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID={`host-accept-${proposal.id}`}
          >
            <Text style={styles.acceptText}>{t('host.accept')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.outlineButton]}
            onPress={() => setIsCountering(true)}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID={`host-counter-${proposal.id}`}
          >
            <Text style={styles.outlineText}>{t('host.counter')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.outlineButton]}
            onPress={() => onReject(proposal.id)}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID={`host-reject-${proposal.id}`}
          >
            <Text style={styles.rejectText}>{t('host.reject')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.counterContainer}>
          <CounterBackInput
            basePriceCents={basePriceCents}
            currency={proposal.currency}
            hostFeeRateBps={hostFeeRateBps}
            cleanerRateBps={cleanerRateBps}
            disabled={disabled}
            onSubmit={handleCounterSubmit}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  title: {
    flex: 1,
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  body: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  secondary: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  button: {
    flex: 1,
    height: 40,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    backgroundColor: COLORS.accent,
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: COLORS.outline,
  },
  acceptText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: '#0B0C10',
  },
  outlineText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  rejectText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.reject,
  },
  counterContainer: {
    marginTop: SPACING.sm,
  },
});

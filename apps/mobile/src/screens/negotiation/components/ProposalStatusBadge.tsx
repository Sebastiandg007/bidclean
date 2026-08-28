/**
 * ProposalStatusBadge — small colored badge showing a proposal's status,
 * localized via i18n.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ProposalStatus } from '../negotiation.types';

const STATUS_COLORS: Record<ProposalStatus, string> = {
  PENDING: '#FFD93D',
  ACCEPTED: '#30D158',
  REJECTED: '#FF6B6B',
  COUNTERED: '#5E5CE6',
  SUPERSEDED: '#636366',
  EXPIRED: '#8E8E93',
} as const;

const COLORS = { badgeText: '#0B0C10' } as const;
const BADGE_RADIUS = 6;
const SPACING = { xs: 4, sm: 8 } as const;
const FONT_SIZE = { badge: 11 } as const;

export interface ProposalStatusBadgeProps {
  status: ProposalStatus;
}

export function ProposalStatusBadge({ status }: ProposalStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');

  return (
    <View
      style={[styles.badge, { backgroundColor: STATUS_COLORS[status] }]}
      testID={`proposal-status-${status}`}
    >
      <Text style={styles.text}>{t(`status.${status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BADGE_RADIUS,
  },
  text: {
    fontSize: FONT_SIZE.badge,
    fontWeight: '700',
    color: COLORS.badgeText,
  },
});

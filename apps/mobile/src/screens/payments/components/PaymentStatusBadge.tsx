/**
 * PaymentStatusBadge — a small pill rendering a payment/payout/dispute status via an
 * i18n key. Color reflects the semantic state (held/released/failed/etc.).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const COLORS = {
  neutral: '#1F2833',
  neutralText: 'rgba(255, 255, 255, 0.8)',
  positive: '#00F5D4',
  positiveText: '#0B0C10',
  warning: '#F5A623',
  danger: '#FF5C5C',
  dangerText: '#FFFFFF',
} as const;

const SPACING = { xs: 4, sm: 8 } as const;
const FONT_SIZE = 12;
const RADIUS = 999;

/** Semantic tone of a badge */
export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'danger';

export interface PaymentStatusBadgeProps {
  /** i18n key resolving to the label text */
  labelKey: string;
  tone: BadgeTone;
  testID?: string;
}

function toneStyle(tone: BadgeTone): { bg: string; fg: string } {
  switch (tone) {
    case 'positive':
      return { bg: COLORS.positive, fg: COLORS.positiveText };
    case 'warning':
      return { bg: COLORS.warning, fg: COLORS.dangerText };
    case 'danger':
      return { bg: COLORS.danger, fg: COLORS.dangerText };
    default:
      return { bg: COLORS.neutral, fg: COLORS.neutralText };
  }
}

export function PaymentStatusBadge({
  labelKey,
  tone,
  testID,
}: PaymentStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('payments');
  const { bg, fg } = toneStyle(tone);

  return (
    <View style={[styles.badge, { backgroundColor: bg }]} testID={testID ?? 'payment-status-badge'}>
      <Text style={[styles.text, { color: fg }]}>{t(labelKey)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS,
  },
  text: {
    fontSize: FONT_SIZE,
    fontWeight: '600',
  },
});

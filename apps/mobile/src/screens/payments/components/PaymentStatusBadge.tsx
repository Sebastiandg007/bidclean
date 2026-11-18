/**
 * PaymentStatusBadge — a small pill rendering a payment/payout/dispute status via an
 * i18n key. Color reflects the semantic state (held/released/failed/etc.).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import type { SemanticTokens } from '../../../theme';

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

function toneStyle(tone: BadgeTone, theme: SemanticTokens): { bg: string; fg: string } {
  switch (tone) {
    case 'positive':
      return { bg: theme.accent, fg: theme.onAccent };
    case 'warning':
      return { bg: theme.warning, fg: theme.textPrimary };
    case 'danger':
      return { bg: theme.danger, fg: theme.textPrimary };
    default:
      return { bg: theme.surface, fg: theme.textSecondary };
  }
}

export function PaymentStatusBadge({
  labelKey,
  tone,
  testID,
}: PaymentStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('payments');
  const { theme } = useTheme();
  const { bg, fg } = toneStyle(tone, theme);

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

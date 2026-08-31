/**
 * DisputeBanner — shown while a payment's dispute_status is OPEN. Informs both
 * parties that payouts are paused pending resolution.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const COLORS = {
  card: 'rgba(255, 92, 92, 0.12)',
  border: '#FF5C5C',
  title: '#FF8080',
  body: 'rgba(255, 255, 255, 0.75)',
} as const;

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { title: 15, body: 13 } as const;
const RADIUS = 12;

export interface DisputeBannerProps {
  testID?: string;
}

export function DisputeBanner({ testID }: DisputeBannerProps): React.JSX.Element {
  const { t } = useTranslation('payments');

  return (
    <View style={styles.card} testID={testID ?? 'dispute-banner'}>
      <Text style={styles.title}>{t('disputeBanner.title')}</Text>
      <Text style={styles.body}>{t('disputeBanner.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACING.md,
    gap: SPACING.xs,
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
});

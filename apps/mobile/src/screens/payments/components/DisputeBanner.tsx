/**
 * DisputeBanner — shown while a payment's dispute_status is OPEN. Informs both
 * parties that payouts are paused pending resolution.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../../theme';

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { title: 15, body: 13 } as const;
const RADIUS = 12;

export interface DisputeBannerProps {
  testID?: string;
}

export function DisputeBanner({ testID }: DisputeBannerProps): React.JSX.Element {
  const { t } = useTranslation('payments');
  const styles = useStyles();

  return (
    <View style={styles.card} testID={testID ?? 'dispute-banner'}>
      <Text style={styles.title}>{t('disputeBanner.title')}</Text>
      <Text style={styles.body}>{t('disputeBanner.body')}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    backgroundColor: theme.surfaceElevated,
    borderColor: theme.danger,
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.danger,
  },
  body: {
    fontSize: FONT_SIZE.body,
    color: theme.textSecondary,
  },
}));

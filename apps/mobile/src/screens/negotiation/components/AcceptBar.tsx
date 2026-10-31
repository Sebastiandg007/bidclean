/**
 * AcceptBar — "Accept at Host price" action. Disabled when offline (acceptance
 * requires server-side revalidation). Shows an optional hint that accepting
 * supersedes an open counteroffer.
 */

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatMoney } from '../negotiation.format';
import { makeStyles } from '../../../theme';

const SPACING = { xs: 4, sm: 8, md: 16 } as const;
const FONT_SIZE = { button: 16, hint: 12 } as const;
const RADIUS = 12;
const BUTTON_HEIGHT = 52;

export interface AcceptBarProps {
  priceCents: number;
  currency: string;
  disabled?: boolean;
  showSupersedeHint?: boolean;
  onAccept: () => void;
}

export function AcceptBar({
  priceCents,
  currency,
  disabled = false,
  showSupersedeHint = false,
  onAccept,
}: AcceptBarProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');
  const styles = useStyles();
  const price = formatMoney(priceCents, currency);

  return (
    <View style={styles.container} testID="accept-bar">
      {showSupersedeHint && (
        <Text style={styles.hint}>{t('cleaner.acceptSupersedesHint')}</Text>
      )}
      <TouchableOpacity
        style={[styles.button, disabled && styles.buttonDisabled]}
        onPress={onAccept}
        disabled={disabled}
        activeOpacity={disabled ? 1 : 0.7}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        testID="accept-bar-button"
      >
        <Text style={styles.buttonText}>{t('cleaner.acceptAtPrice', { price })}</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  container: {
    gap: SPACING.sm,
  },
  hint: {
    fontSize: FONT_SIZE.hint,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: RADIUS,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
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

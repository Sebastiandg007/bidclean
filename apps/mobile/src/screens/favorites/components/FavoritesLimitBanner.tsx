/**
 * FavoritesLimitBanner — the FREE-limit message + optional PRO upsell (Spec 22).
 *
 * Shown when an add is rejected at the FREE cap (`422`). The message is driven by i18n, never an
 * embedded numeric cap. The upsell CTA is optional (only rendered when an `onUpsell` handler is
 * given). All copy via i18n.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FAVORITES_COLORS, FAVORITES_I18N_KEYS } from '../favorites.constants';

export interface FavoritesLimitBannerProps {
  readonly onDismiss: () => void;
  readonly onUpsell?: () => void;
}

export function FavoritesLimitBanner({
  onDismiss,
  onUpsell,
}: FavoritesLimitBannerProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="favorites-limit-banner">
      <Text style={styles.title}>{t(FAVORITES_I18N_KEYS.LIMIT_TITLE)}</Text>
      <Text style={styles.message}>{t(FAVORITES_I18N_KEYS.LIMIT_MESSAGE)}</Text>
      {onUpsell !== undefined ? (
        <TouchableOpacity style={styles.upsell} onPress={onUpsell} testID="favorites-limit-upsell">
          <Text style={styles.upsellText}>{t(FAVORITES_I18N_KEYS.LIMIT_UPSELL)}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={onDismiss} testID="favorites-limit-dismiss">
        <Text style={styles.dismiss}>{t(FAVORITES_I18N_KEYS.LIMIT_DISMISS)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: FAVORITES_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  title: {
    color: FAVORITES_COLORS.TEXT,
    fontSize: 16,
    fontWeight: '700',
  },
  message: {
    color: FAVORITES_COLORS.TEXT_SECONDARY,
    fontSize: 14,
  },
  upsell: {
    backgroundColor: FAVORITES_COLORS.ACCENT,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  upsellText: {
    color: FAVORITES_COLORS.BACKGROUND,
    fontSize: 15,
    fontWeight: '700',
  },
  dismiss: {
    color: FAVORITES_COLORS.TEXT_SECONDARY,
    fontSize: 14,
    textAlign: 'center',
  },
});

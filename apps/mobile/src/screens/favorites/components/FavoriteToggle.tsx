/**
 * FavoriteToggle — the heart control reflecting `is-favorite` (Spec 22).
 *
 * On tap it delegates to the store's optimistic `toggle` (add/remove). The active heart uses the
 * BidClean accent; a `422` limit surfaces the store's `limitReached` (the parent renders the limit
 * banner). All copy via i18n. Disabled while a submission is in flight.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FAVORITES_COLORS, FAVORITES_I18N_KEYS } from '../favorites.constants';

export interface FavoriteToggleProps {
  readonly isFavorite: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}

export function FavoriteToggle({
  isFavorite,
  disabled = false,
  onToggle,
}: FavoriteToggleProps): React.JSX.Element {
  const { t } = useTranslation();
  const labelKey = isFavorite ? FAVORITES_I18N_KEYS.TOGGLE_REMOVE : FAVORITES_I18N_KEYS.TOGGLE_ADD;
  return (
    <TouchableOpacity
      style={[styles.container, disabled && styles.disabled]}
      onPress={onToggle}
      disabled={disabled}
      testID="favorite-toggle"
      accessibilityRole="button"
      accessibilityLabel={t(labelKey)}
      accessibilityState={{ selected: isFavorite, disabled }}
    >
      <Text style={[styles.heart, isFavorite && styles.heartActive]} testID="favorite-toggle-heart">
        {isFavorite ? '\u2665' : '\u2661'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FAVORITES_COLORS.CARD,
  },
  heart: {
    fontSize: 22,
    color: FAVORITES_COLORS.TEXT_SECONDARY,
  },
  heartActive: {
    color: FAVORITES_COLORS.ACCENT,
  },
  disabled: {
    opacity: 0.5,
  },
});

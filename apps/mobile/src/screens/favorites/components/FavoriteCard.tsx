/**
 * FavoriteCard — one favorite list item (Spec 22).
 *
 * Shows the Cleaner's safe display info + a remove action. A currently-ineligible Cleaner is shown
 * with an `unavailable` badge (from the backend display-only hint) rather than hidden; the row is
 * never auto-removed. All copy via i18n; BidClean dark tokens.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FAVORITES_COLORS, FAVORITES_I18N_KEYS } from '../favorites.constants';
import type { FavoriteView } from '../favorites.types';

export interface FavoriteCardProps {
  readonly favorite: FavoriteView;
  readonly onRemove: (cleanerId: string) => void;
}

export function FavoriteCard({ favorite, onRemove }: FavoriteCardProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID={`favorite-card-${favorite.cleanerId}`}>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {favorite.displayName}
        </Text>
        {favorite.unavailable ? (
          <Text style={styles.unavailable} testID="favorite-card-unavailable">
            {t(FAVORITES_I18N_KEYS.CARD_UNAVAILABLE)}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.remove}
        onPress={() => onRemove(favorite.cleanerId)}
        testID={`favorite-card-remove-${favorite.cleanerId}`}
      >
        <Text style={styles.removeText}>{t(FAVORITES_I18N_KEYS.CARD_REMOVE)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FAVORITES_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: FAVORITES_COLORS.TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  unavailable: {
    color: FAVORITES_COLORS.TEXT_SECONDARY,
    fontSize: 13,
  },
  remove: {
    borderColor: FAVORITES_COLORS.DANGER,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  removeText: {
    color: FAVORITES_COLORS.DANGER,
    fontSize: 14,
    fontWeight: '600',
  },
});

/**
 * FavoritesListScreen (Host) — the paginated favorites list with remove (Spec 22).
 *
 * Lists the Host's favorite Cleaners (view + remove), paginated via keyset cursor. A currently
 * ineligible Cleaner is shown with an `unavailable` badge rather than hidden (never auto-removed).
 * A `422` add elsewhere surfaces the limit banner via the store's `limitReached`. Dark BidClean
 * tokens; all copy via i18n.
 */

import React, { useCallback, useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { FavoriteCard } from './components/FavoriteCard';
import { FavoritesLimitBanner } from './components/FavoritesLimitBanner';
import { FAVORITES_COLORS, FAVORITES_I18N_KEYS } from './favorites.constants';
import { useFavoritesStore } from './useFavoritesStore';
import type { FavoriteView } from './favorites.types';

export interface FavoritesListScreenProps {
  navigation?: { goBack: () => void };
}

export function FavoritesListScreen(_props: FavoritesListScreenProps): React.JSX.Element {
  const { t } = useTranslation();

  const items = useFavoritesStore((store) => store.items);
  const error = useFavoritesStore((store) => store.error);
  const limitReached = useFavoritesStore((store) => store.limitReached);
  const nextCursor = useFavoritesStore((store) => store.nextCursor);
  const loadFavorites = useFavoritesStore((store) => store.loadFavorites);
  const loadMore = useFavoritesStore((store) => store.loadMore);
  const toggle = useFavoritesStore((store) => store.toggle);
  const clearError = useFavoritesStore((store) => store.clearError);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const onEndReached = useCallback(() => {
    if (nextCursor !== null) {
      void loadMore();
    }
  }, [nextCursor, loadMore]);

  const renderItem = useCallback(
    ({ item }: { item: FavoriteView }) => (
      <FavoriteCard favorite={item} onRemove={(cleanerId) => void toggle(cleanerId)} />
    ),
    [toggle],
  );

  return (
    <SafeAreaView style={styles.screen} testID="favorites-list-screen">
      <Text style={styles.title}>{t(FAVORITES_I18N_KEYS.LIST_TITLE)}</Text>

      {limitReached ? (
        <FavoritesLimitBanner onDismiss={clearError} />
      ) : null}

      {error !== null && !limitReached ? (
        <Text style={styles.error} testID="favorites-list-error">
          {t(error)}
        </Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.cleanerId}
        renderItem={renderItem}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <Text style={styles.empty} testID="favorites-list-empty">
            {t(FAVORITES_I18N_KEYS.LIST_EMPTY)}
          </Text>
        }
        testID="favorites-list"
      />
      <View />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: FAVORITES_COLORS.BACKGROUND,
    padding: 20,
    gap: 16,
  },
  title: {
    color: FAVORITES_COLORS.TEXT,
    fontSize: 24,
    fontWeight: '700',
  },
  content: {
    paddingVertical: 8,
  },
  empty: {
    color: FAVORITES_COLORS.TEXT_SECONDARY,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 32,
  },
  error: {
    color: FAVORITES_COLORS.DANGER,
    fontSize: 13,
  },
});

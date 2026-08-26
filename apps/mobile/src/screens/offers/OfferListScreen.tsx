/**
 * OfferListScreen — Tab-filtered list of Host offers.
 *
 * Features:
 * - Tab bar with state filters: Active, Completed, Expired, Cancelled
 * - FlatList with OfferCard items
 * - Pull-to-refresh (reloads page 1)
 * - Infinite scroll (onEndReached loads next page)
 * - Loading footer indicator when fetching more
 * - Per-tab empty states with custom messages
 * - FAB (Floating Action Button) for "Create Offer"
 * - SafeAreaView wrapper
 * - Accessibility: tab roles, list roles, FAB label
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Offer, OfferState } from './offers.types';
import { useOffersStore } from './useOffers';
import { OfferCard } from './components/OfferCard';
import { COLORS, FONT_SIZE, OFFER_ROUTES, SPACING } from './offers.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TabDefinition {
  key: OfferState;
  labelKey: string;
}

interface OfferListScreenProps {
  navigation?: {
    navigate: (route: string, params?: Record<string, unknown>) => void;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS: TabDefinition[] = [
  { key: 'ACTIVE', labelKey: 'offers.list.tabs.active' },
  { key: 'COMPLETED', labelKey: 'offers.list.tabs.completed' },
  { key: 'EXPIRED', labelKey: 'offers.list.tabs.expired' },
  { key: 'CANCELLED', labelKey: 'offers.list.tabs.cancelled' },
];

const DEFAULT_TAB_INDEX = 0;
const END_REACHED_THRESHOLD = 0.3;
const FAB_SIZE = 56;
const FAB_BORDER_RADIUS = 28;
const FAB_ICON_SIZE = 28;
const TAB_UNDERLINE_HEIGHT = 3;
const TAB_UNDERLINE_RADIUS = 2;
const ACTIVE_OPACITY = 0.7;

const EMPTY_STATE_ICONS: Record<OfferState, string> = {
  ACTIVE: '📡',
  COMPLETED: '✅',
  EXPIRED: '⏰',
  CANCELLED: '🚫',
  DRAFT: '📝',
  PUBLISHED: '📢',
  MATCHED: '🤝',
};

const EMPTY_STATE_MESSAGES: Record<OfferState, string> = {
  ACTIVE: 'offers.list.empty.active',
  COMPLETED: 'offers.list.empty.completed',
  EXPIRED: 'offers.list.empty.expired',
  CANCELLED: 'offers.list.empty.cancelled',
  DRAFT: 'offers.list.empty.draft',
  PUBLISHED: 'offers.list.empty.published',
  MATCHED: 'offers.list.empty.matched',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferListScreen({ navigation }: OfferListScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const [activeTabIndex, setActiveTabIndex] = useState(DEFAULT_TAB_INDEX);
  const flatListRef = useRef<FlatList<Offer>>(null);

  const {
    offers,
    isLoading,
    hasMore,
    page,
    fetchOffers,
  } = useOffersStore();

  const activeTab = TABS[activeTabIndex] as TabDefinition;
  const currentFilter = activeTab.key;

  // ─── Initial Fetch ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetchOffers(currentFilter, 1);
  }, [currentFilter, fetchOffers]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleTabPress = useCallback(
    (index: number) => {
      if (index === activeTabIndex) return;
      setActiveTabIndex(index);
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    },
    [activeTabIndex],
  );

  const handleRefresh = useCallback(() => {
    fetchOffers(currentFilter, 1);
  }, [currentFilter, fetchOffers]);

  const handleEndReached = useCallback(() => {
    if (isLoading || !hasMore) return;
    fetchOffers(currentFilter, page + 1);
  }, [isLoading, hasMore, currentFilter, page, fetchOffers]);

  const handleOfferPress = useCallback(
    (offerId: string) => {
      navigation?.navigate(OFFER_ROUTES.OfferDetail, { offerId });
    },
    [navigation],
  );

  const handleCreateOffer = useCallback(() => {
    navigation?.navigate(OFFER_ROUTES.CreateOffer);
  }, [navigation]);

  // ─── Render Helpers ────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Offer>) => (
      <OfferCard offer={item} onPress={handleOfferPress} />
    ),
    [handleOfferPress],
  );

  const keyExtractor = useCallback((item: Offer) => item.id, []);

  const ListFooter = useMemo(() => {
    if (!isLoading || offers.length === 0) return null;
    return (
      <View style={styles.footer} testID="offer-list-loading-footer">
        <ActivityIndicator color={COLORS.accent} size="small" />
      </View>
    );
  }, [isLoading, offers.length]);

  const ListEmpty = useMemo(() => {
    if (isLoading) return null;
    const icon = EMPTY_STATE_ICONS[currentFilter];
    const messageKey = EMPTY_STATE_MESSAGES[currentFilter];

    return (
      <View style={styles.emptyContainer} testID="offer-list-empty-state">
        <Text style={styles.emptyIcon}>{icon}</Text>
        <Text style={styles.emptyMessage}>{t(messageKey)}</Text>
      </View>
    );
  }, [isLoading, currentFilter, t]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} testID="offer-list-screen">
      <View style={styles.container}>
        {/* Screen Title */}
        <Text style={styles.title} accessibilityRole="header">
          {t('offers.list.title')}
        </Text>

        {/* Tab Bar */}
        <View
          style={styles.tabBar}
          accessibilityRole="tablist"
          testID="offer-list-tab-bar"
        >
          {TABS.map((tab, index) => {
            const isActive = index === activeTabIndex;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tabItem}
                onPress={() => handleTabPress(index)}
                activeOpacity={ACTIVE_OPACITY}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={t(tab.labelKey)}
                testID={`offer-tab-${tab.key}`}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    isActive && styles.tabLabelActive,
                  ]}
                >
                  {t(tab.labelKey)}
                </Text>
                {isActive && <View style={styles.tabUnderline} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Offer List */}
        <FlatList
          ref={flatListRef}
          data={offers}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={isLoading && page === 1}
          onRefresh={handleRefresh}
          onEndReached={handleEndReached}
          onEndReachedThreshold={END_REACHED_THRESHOLD}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={ListEmpty}
          accessibilityRole="list"
          testID="offer-list-flatlist"
        />

        {/* FAB — Create Offer */}
        <TouchableOpacity
          style={styles.fab}
          onPress={handleCreateOffer}
          activeOpacity={ACTIVE_OPACITY}
          accessibilityRole="button"
          accessibilityLabel={t('offers.list.fab.createOffer')}
          testID="offer-list-fab"
        >
          <Text style={styles.fabIcon}>+</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginHorizontal: SPACING.md,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    position: 'relative',
  },
  tabLabel: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  tabLabelActive: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: SPACING.sm,
    right: SPACING.sm,
    height: TAB_UNDERLINE_HEIGHT,
    borderRadius: TAB_UNDERLINE_RADIUS,
    backgroundColor: COLORS.accent,
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl + FAB_SIZE,
    flexGrow: 1,
  },
  footer: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  emptyIcon: {
    fontSize: FAB_SIZE,
    marginBottom: SPACING.md,
  },
  emptyMessage: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
  },
  fab: {
    position: 'absolute',
    bottom: SPACING.lg,
    right: SPACING.md,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_BORDER_RADIUS,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  fabIcon: {
    fontSize: FAB_ICON_SIZE,
    fontWeight: '300',
    color: COLORS.background,
    lineHeight: FAB_ICON_SIZE + 2,
  },
});

export default OfferListScreen;

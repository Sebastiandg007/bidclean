/**
 * OfferListView — Alternative list-based view for the Offer Radar.
 *
 * Renders available offers as a vertical scrollable FlatList with:
 * - OfferCard items sorted by current store sort option
 * - Ad slot injection every 5th position for free-tier users
 * - Pull-to-refresh (triggers store.refreshOffers)
 * - Infinite scroll (onEndReached → store.loadMoreOffers)
 * - Skeleton loaders during initial fetch
 * - Empty state when no offers are available
 */

import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';

import { makeStyles, useTheme } from '../../../../theme';
import type { RadarOffer } from '../../radar.types';
import { AD_SLOT_FIRST_POSITION, AD_SLOT_INTERVAL } from '../../radar.constants';
import { useRadarStore } from '../../useRadarStore';
import { useAdVisibility } from '../../hooks/useAdVisibility';
import { OfferCard } from './OfferCard';
import { AdSlot } from './AdSlot';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  sm: 8,
  md: 16,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const ON_END_REACHED_THRESHOLD = 0.5;
const SKELETON_COUNT = 5;
const SKELETON_CARD_HEIGHT = 104;
const SKELETON_BORDER_RADIUS = 12;
const SKELETON_PHOTO_SIZE = 72;
const SKELETON_PHOTO_BORDER_RADIUS = 8;
const SKELETON_LINE_HEIGHT = 12;
const SKELETON_LINE_WIDTH_LONG = '60%';
const SKELETON_LINE_WIDTH_SHORT = '40%';

// ─── Types ───────────────────────────────────────────────────────────────────

type ListItem =
  | { type: 'offer'; data: RadarOffer }
  | { type: 'ad'; key: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Injects ad slots into the offer list at configured positions.
 * Ad slots appear at positions 4, 9, 14, 19... (every 5th, 0-indexed).
 */
function injectAdSlots(offers: RadarOffer[], adsEnabled: boolean): ListItem[] {
  if (!adsEnabled || offers.length === 0) {
    return offers.map((data) => ({ type: 'offer' as const, data }));
  }

  const items: ListItem[] = [];
  let adIndex = 0;

  for (const offer of offers) {
    const currentPosition = items.length;

    // Check if current position should be an ad slot
    if (
      currentPosition === AD_SLOT_FIRST_POSITION ||
      (currentPosition > AD_SLOT_FIRST_POSITION &&
        (currentPosition - AD_SLOT_FIRST_POSITION) % AD_SLOT_INTERVAL === 0)
    ) {
      items.push({ type: 'ad', key: `ad-${adIndex}` });
      adIndex++;
    }

    items.push({ type: 'offer', data: offer });
  }

  return items;
}

function getItemKey(item: ListItem): string {
  if (item.type === 'ad') {
    return item.key;
  }
  return item.data.offerId;
}

// ─── Skeleton Component ──────────────────────────────────────────────────────

function OfferCardSkeleton(): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.skeletonCard} testID="offer-card-skeleton">
      <View style={styles.skeletonPhoto} />
      <View style={styles.skeletonContent}>
        <View style={[styles.skeletonLine, styles.skeletonLineLong]} />
        <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
        <View style={[styles.skeletonLine, styles.skeletonLineLong]} />
      </View>
    </View>
  );
}

function SkeletonLoader(): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.container} testID="offer-list-skeleton">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <OfferCardSkeleton key={`skeleton-${i}`} />
      ))}
    </View>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferListView(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const offers = useRadarStore((state) => state.getOffersList());
  const isLoading = useRadarStore((state) => state.isLoading);
  const isRefreshing = useRadarStore((state) => state.isRefreshing);
  const pagination = useRadarStore((state) => state.pagination);
  const refreshOffers = useRadarStore((state) => state.refreshOffers);
  const loadMoreOffers = useRadarStore((state) => state.loadMoreOffers);

  const { adsEnabled, isLoading: adsLoading } = useAdVisibility();

  // Show skeleton on initial load (no offers yet + loading)
  const showSkeleton = isLoading && offers.length === 0;

  // Build list items with ad injection
  const listItems = useMemo(
    () => injectAdSlots(offers, adsEnabled && !adsLoading),
    [offers, adsEnabled, adsLoading],
  );

  const hasMore = pagination.page < pagination.totalPages;

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handleRefresh = useCallback((): void => {
    refreshOffers();
  }, [refreshOffers]);

  const handleEndReached = useCallback((): void => {
    if (hasMore && !isLoading) {
      loadMoreOffers();
    }
  }, [hasMore, isLoading, loadMoreOffers]);

  // ─── Render Items ──────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>): React.JSX.Element => {
      if (item.type === 'ad') {
        return <AdSlot />;
      }
      return <OfferCard offer={item.data} />;
    },
    [],
  );

  // ─── Loading Footer ────────────────────────────────────────────────────

  const renderFooter = useCallback((): React.JSX.Element | null => {
    if (!isLoading || offers.length === 0) {
      return null;
    }
    // Show a single skeleton card as loading indicator for pagination
    return <OfferCardSkeleton />;
  }, [isLoading, offers.length]);

  // ─── Skeleton State ────────────────────────────────────────────────────

  if (showSkeleton) {
    return <SkeletonLoader />;
  }

  // ─── Main List ─────────────────────────────────────────────────────────

  return (
    <FlatList<ListItem>
      data={listItems}
      renderItem={renderItem}
      keyExtractor={getItemKey}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      onEndReached={handleEndReached}
      onEndReachedThreshold={ON_END_REACHED_THRESHOLD}
      ListFooterComponent={renderFooter}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
      showsVerticalScrollIndicator={false}
      testID="offer-list-view"
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  contentContainer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  // Skeleton styles
  skeletonCard: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: SKELETON_BORDER_RADIUS,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    height: SKELETON_CARD_HEIGHT,
  },
  skeletonPhoto: {
    width: SKELETON_PHOTO_SIZE,
    height: SKELETON_PHOTO_SIZE,
    borderRadius: SKELETON_PHOTO_BORDER_RADIUS,
    backgroundColor: theme.surfaceElevated,
    marginRight: SPACING.md,
  },
  skeletonContent: {
    flex: 1,
    justifyContent: 'space-evenly',
  },
  skeletonLine: {
    height: SKELETON_LINE_HEIGHT,
    borderRadius: SKELETON_LINE_HEIGHT / 2,
    backgroundColor: theme.surfaceElevated,
  },
  skeletonLineLong: {
    width: SKELETON_LINE_WIDTH_LONG,
  },
  skeletonLineShort: {
    width: SKELETON_LINE_WIDTH_SHORT,
  },
}));

export default OfferListView;

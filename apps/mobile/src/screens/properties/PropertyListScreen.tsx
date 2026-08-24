/**
 * PropertyListScreen
 *
 * Paginated list of the Host's properties with search and type filter.
 * Displays PropertyCard items in a FlatList with pull-to-refresh.
 * Includes empty state CTA and FAB for creating new properties.
 *
 * Features:
 * - Debounced search (300ms) by name/address
 * - Horizontal scrollable type filter chips
 * - Infinite scroll pagination (load more on end reached)
 * - Pull-to-refresh
 * - Empty state with "Add your first property" CTA
 * - Error state with retry
 * - FAB (bottom-right) for creating new properties
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, FONT_SIZE, SPACING, PROPERTY_TYPES, DEFAULT_PAGE_SIZE } from './properties.constants';
import type { PropertyListItem, PropertyListQuery, PropertyType } from './properties.types';
import { usePropertiesStore } from './useProperties';
import { PropertyCard } from './components/PropertyCard';

// ─── Constants ───────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300;
const END_REACHED_THRESHOLD = 0.5;
const FAB_SIZE = 56;

// ─── Hook: useDebounce ───────────────────────────────────────────────────────

/**
 * Debounces a value by the specified delay (ms).
 * Returns the debounced value that updates after the delay.
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface TypeFilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  testID?: string;
}

/** Single filter chip for property type selection */
function TypeFilterChip({ label, isActive, onPress, testID }: TypeFilterChipProps) {
  return (
    <Pressable
      style={[styles.chip, isActive && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface EmptyStateProps {
  onAddPress: () => void;
}

/** Empty state displayed when no properties exist */
function EmptyState({ onAddPress }: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyContainer} testID="property-list-empty">
      <Text style={styles.emptyIcon}>🏠</Text>
      <Text style={styles.emptyTitle}>
        {t('properties.list.empty_title', { defaultValue: 'No properties yet' })}
      </Text>
      <Text style={styles.emptySubtitle}>
        {t('properties.list.empty_subtitle', {
          defaultValue: 'Add your first property to start receiving cleaning offers',
        })}
      </Text>
      <Pressable
        style={styles.emptyCta}
        onPress={onAddPress}
        accessibilityRole="button"
        accessibilityLabel={t('properties.list.add_first', { defaultValue: 'Add your first property' })}
        testID="property-list-empty-cta"
      >
        <Text style={styles.emptyCtaText}>
          {t('properties.list.add_first', { defaultValue: 'Add your first property' })}
        </Text>
      </Pressable>
    </View>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

/** Error state displayed when fetch fails */
function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.errorContainer} testID="property-list-error">
      <Text style={styles.errorIcon}>⚠️</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      <Pressable
        style={styles.retryButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t('properties.list.retry', { defaultValue: 'Retry' })}
        testID="property-list-retry"
      >
        <Text style={styles.retryButtonText}>
          {t('properties.list.retry', { defaultValue: 'Retry' })}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Navigation Callbacks (placeholder until real navigation) ─────────────────

interface PropertyListScreenProps {
  onNavigateToDetail?: (propertyId: string) => void;
  onNavigateToCreate?: () => void;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const PropertyListScreen: React.FC<PropertyListScreenProps> = ({
  onNavigateToDetail,
  onNavigateToCreate,
}) => {
  const { t } = useTranslation();

  // Store state
  const items = usePropertiesStore((s) => s.items);
  const total = usePropertiesStore((s) => s.total);
  const isListLoading = usePropertiesStore((s) => s.isListLoading);
  const error = usePropertiesStore((s) => s.error);
  const currentPage = usePropertiesStore((s) => s.currentPage);
  const totalPages = usePropertiesStore((s) => s.totalPages);
  const fetchList = usePropertiesStore((s) => s.fetchList);
  const clearError = usePropertiesStore((s) => s.clearError);

  // Local state
  const [searchText, setSearchText] = useState('');
  const [selectedType, setSelectedType] = useState<PropertyType | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Ref to track if more pages are loading
  const isLoadingMoreRef = useRef(false);

  // Debounced search
  const debouncedSearch = useDebounce(searchText, SEARCH_DEBOUNCE_MS);

  // Build query from current filters
  const buildQuery = useCallback(
    (page: number): PropertyListQuery => ({
      page,
      limit: DEFAULT_PAGE_SIZE,
      search: debouncedSearch || undefined,
      type: selectedType ?? undefined,
    }),
    [debouncedSearch, selectedType],
  );

  // Initial fetch and refetch on filter change
  useEffect(() => {
    fetchList(buildQuery(1));
  }, [fetchList, buildQuery]);

  // Pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    clearError();
    await fetchList(buildQuery(1));
    setIsRefreshing(false);
  }, [fetchList, buildQuery, clearError]);

  // Load more (infinite scroll)
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMoreRef.current || isListLoading || currentPage >= totalPages) {
      return;
    }

    isLoadingMoreRef.current = true;
    await fetchList(buildQuery(currentPage + 1));
    isLoadingMoreRef.current = false;
  }, [fetchList, buildQuery, currentPage, totalPages, isListLoading]);

  // Retry on error
  const handleRetry = useCallback(() => {
    clearError();
    fetchList(buildQuery(1));
  }, [fetchList, buildQuery, clearError]);

  // Card press → navigate to detail
  const handleCardPress = useCallback(
    (propertyId: string) => {
      onNavigateToDetail?.(propertyId);
    },
    [onNavigateToDetail],
  );

  // FAB press → navigate to create
  const handleFabPress = useCallback(() => {
    onNavigateToCreate?.();
  }, [onNavigateToCreate]);

  // Type filter toggle
  const handleTypeSelect = useCallback((type: PropertyType | null) => {
    setSelectedType((prev) => (prev === type ? null : type));
  }, []);

  // Type chip data with "All" option
  const typeChips = useMemo(() => {
    const allChip = {
      value: null as PropertyType | null,
      label: t('properties.filter.all', { defaultValue: 'All' }),
    };

    const typeOptions = PROPERTY_TYPES.map((pt) => ({
      value: pt.value as PropertyType | null,
      label: t(pt.labelKey, { defaultValue: pt.value }),
    }));

    return [allChip, ...typeOptions];
  }, [t]);

  // Render item
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PropertyListItem>) => (
      <View style={styles.cardWrapper}>
        <PropertyCard property={item} onPress={handleCardPress} />
      </View>
    ),
    [handleCardPress],
  );

  // Key extractor
  const keyExtractor = useCallback((item: PropertyListItem) => item.id, []);

  // Footer loading indicator
  const renderFooter = useCallback(() => {
    if (!isListLoading || currentPage === 1) return null;

    return (
      <View style={styles.footerLoader} testID="property-list-footer-loader">
        <ActivityIndicator color={COLORS.accent} size="small" />
      </View>
    );
  }, [isListLoading, currentPage]);

  // Show empty state when not loading, no error, and no items
  const showEmptyState = !isListLoading && !error && items.length === 0;
  // Show error state
  const showErrorState = !isListLoading && error !== null;
  // Show initial loading (first page)
  const showInitialLoading = isListLoading && items.length === 0 && !error;

  return (
    <View style={styles.container} testID="property-list-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t('properties.list.title', { defaultValue: 'My Properties' })}
        </Text>
        {total > 0 && (
          <Text style={styles.countBadge} testID="property-list-count">
            {total}
          </Text>
        )}
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('properties.list.search_placeholder', {
            defaultValue: 'Search by name or address...',
          })}
          placeholderTextColor={COLORS.textSecondary}
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('properties.list.search_a11y', {
            defaultValue: 'Search properties',
          })}
          testID="property-list-search"
        />
      </View>

      {/* Type Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContainer}
        style={styles.chipsScroll}
        testID="property-list-type-filters"
      >
        {typeChips.map((chip) => (
          <TypeFilterChip
            key={chip.value ?? 'all'}
            label={chip.label}
            isActive={selectedType === chip.value}
            onPress={() => handleTypeSelect(chip.value)}
            testID={`property-filter-chip-${chip.value ?? 'all'}`}
          />
        ))}
      </ScrollView>

      {/* Content Area */}
      {showInitialLoading && (
        <View style={styles.loaderContainer} testID="property-list-loading">
          <ActivityIndicator color={COLORS.accent} size="large" />
          <Text style={styles.loaderText}>
            {t('properties.list.loading', { defaultValue: 'Loading properties...' })}
          </Text>
        </View>
      )}

      {showErrorState && (
        <ErrorState message={error!} onRetry={handleRetry} />
      )}

      {showEmptyState && <EmptyState onAddPress={handleFabPress} />}

      {!showInitialLoading && !showErrorState && !showEmptyState && (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={END_REACHED_THRESHOLD}
          ListFooterComponent={renderFooter}
          showsVerticalScrollIndicator={false}
          testID="property-list-flatlist"
          accessibilityRole="list"
        />
      )}

      {/* Floating Action Button */}
      <Pressable
        style={styles.fab}
        onPress={handleFabPress}
        accessibilityRole="button"
        accessibilityLabel={t('properties.list.fab_a11y', {
          defaultValue: 'Create new property',
        })}
        testID="property-list-fab"
      >
        <Text style={styles.fabIcon}>＋</Text>
      </Pressable>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  countBadge: {
    marginLeft: SPACING.sm,
    backgroundColor: COLORS.accent,
    color: COLORS.background,
    fontSize: FONT_SIZE.label,
    fontWeight: '700',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
    overflow: 'hidden',
  },
  searchContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  searchInput: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + SPACING.xs,
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipsScroll: {
    maxHeight: 48,
  },
  chipsContainer: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.label,
    fontWeight: '500',
  },
  chipTextActive: {
    color: COLORS.background,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl + FAB_SIZE,
  },
  cardWrapper: {
    marginBottom: SPACING.sm,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
    marginTop: SPACING.sm,
  },
  footerLoader: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  emptyCta: {
    backgroundColor: COLORS.accent,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + SPACING.xs,
  },
  emptyCtaText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  errorMessage: {
    fontSize: FONT_SIZE.body,
    color: COLORS.error,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  retryButton: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  retryButtonText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: SPACING.lg,
    right: SPACING.md,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  fabIcon: {
    fontSize: 28,
    color: COLORS.background,
    fontWeight: '700',
    lineHeight: 32,
  },
});

export default PropertyListScreen;

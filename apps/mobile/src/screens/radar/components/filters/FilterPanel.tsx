/**
 * FilterPanel — Bottom sheet container for all radar filter sub-components.
 *
 * Renders ServiceTypeChips, PriceRangeSlider, DistanceSlider, and DateRangeFilter
 * inside an animated bottom sheet. Provides "Clear all" action and shows active
 * filter count via badge. Filter changes trigger server-side re-fetch.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.5
 */

import React, { useCallback, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRadarStore } from '../../useRadarStore';
import { ServiceTypeChips } from './ServiceTypeChips';
import { PriceRangeSlider } from './PriceRangeSlider';
import { DistanceSlider } from './DistanceSlider';
import { DateRangeFilter } from './DateRangeFilter';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  overlay: 'rgba(0, 0, 0, 0.6)',
  handle: 'rgba(255, 255, 255, 0.3)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  title: 18,
  body: 14,
  badge: 12,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const SHEET_BORDER_RADIUS = 20;
const HANDLE_WIDTH = 40;
const HANDLE_HEIGHT = 4;
const BADGE_SIZE = 20;
const SWIPE_THRESHOLD = 100;
const SECTION_GAP = 24;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FilterPanelProps {
  /** Whether the filter panel is visible */
  visible: boolean;
  /** Callback to close the panel */
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FilterPanel({ visible, onClose }: FilterPanelProps): React.JSX.Element {
  const { t } = useTranslation('radar');
  const clearFilters = useRadarStore((state) => state.clearFilters);
  const activeFilterCount = useRadarStore((state) => state.getActiveFilterCount());

  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 0,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > SWIPE_THRESHOLD) {
          onClose();
        }
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const handleClearAll = useCallback(() => {
    clearFilters();
  }, [clearFilters]);

  const handleOverlayPress = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="filter-panel-modal"
    >
      <Pressable style={styles.overlay} onPress={handleOverlayPress}>
        <View />
      </Pressable>

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        {/* Handle bar */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('filter.title')}</Text>
            {activeFilterCount > 0 && (
              <View style={styles.badge} testID="filter-count-badge">
                <Text style={styles.badgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            onPress={handleClearAll}
            accessibilityRole="button"
            accessibilityLabel={t('filter.clearAll')}
            testID="filter-clear-all-button"
          >
            <Text style={styles.clearAllText}>{t('filter.clearAll')}</Text>
          </TouchableOpacity>
        </View>

        {/* Filter sections */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.section}>
            <ServiceTypeChips />
          </View>

          <View style={styles.section}>
            <PriceRangeSlider />
          </View>

          <View style={styles.section}>
            <DistanceSlider />
          </View>

          <View style={styles.section}>
            <DateRangeFilter />
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '80%',
    backgroundColor: COLORS.card,
    borderTopLeftRadius: SHEET_BORDER_RADIUS,
    borderTopRightRadius: SHEET_BORDER_RADIUS,
    paddingBottom: SPACING.xl,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  handle: {
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: HANDLE_HEIGHT / 2,
    backgroundColor: COLORS.handle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
  },
  badgeText: {
    fontSize: FONT_SIZE.badge,
    fontWeight: '700',
    color: COLORS.background,
  },
  clearAllText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.accent,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  section: {
    marginBottom: SECTION_GAP,
  },
});

export default FilterPanel;

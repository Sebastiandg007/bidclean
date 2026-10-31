/**
 * RadarHeader — Top bar for the Radar screen.
 *
 * Contains:
 * - Screen title
 * - Filter button with active filter count badge
 *
 * @requirements 5.2
 */

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../../theme';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  title: 20,
  badge: 11,
  button: 14,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const BADGE_SIZE = 18;
const BUTTON_HEIGHT = 36;
const BUTTON_BORDER_RADIUS = 18;
const HEADER_HEIGHT = 52;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface RadarHeaderProps {
  /** Number of currently active filters */
  activeFilterCount: number;
  /** Callback when filter button is pressed */
  onFilterPress: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RadarHeader({
  activeFilterCount,
  onFilterPress,
}: RadarHeaderProps): React.JSX.Element {
  const { t } = useTranslation('radar');
  const styles = useStyles();

  return (
    <View style={styles.container} testID="radar-header">
      <Text style={styles.title}>{t('header.title')}</Text>

      <TouchableOpacity
        style={styles.filterButton}
        onPress={onFilterPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('header.filterAccessibility', { count: activeFilterCount })}
        testID="radar-filter-button"
      >
        <Text style={styles.filterButtonText}>{t('header.filters')}</Text>

        {activeFilterCount > 0 && (
          <View style={styles.badge} testID="filter-count-badge">
            <Text style={styles.badgeText}>{activeFilterCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: HEADER_HEIGHT,
    paddingHorizontal: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BUTTON_HEIGHT,
    paddingHorizontal: SPACING.md,
    backgroundColor: theme.surface,
    borderRadius: BUTTON_BORDER_RADIUS,
    gap: SPACING.sm,
  },
  filterButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '500',
    color: theme.textPrimary,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: FONT_SIZE.badge,
    fontWeight: '700',
    color: theme.onAccent,
  },
}));

export default RadarHeader;

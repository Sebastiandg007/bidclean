/**
 * FavoritesToggle component.
 *
 * Switch toggle for enabling favorites-first delivery.
 * When enabled, the offer is delivered to the Host's favorite
 * Cleaners first before expanding to PRO and FREE tiers.
 * Includes an info tooltip explaining the delivery behavior
 * and a disabled state when the Host has no favorites.
 */

import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, FONT_SIZE, SPACING } from '../offers.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FavoritesToggleProps {
  /** Whether favorites-first delivery is enabled */
  enabled: boolean;
  /** Callback fired when the toggle value changes */
  onChange: (value: boolean) => void;
  /** Whether the Host has at least one favorite Cleaner */
  hasFavorites: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FavoritesToggle({
  enabled,
  onChange,
  hasFavorites,
}: FavoritesToggleProps) {
  const { t } = useTranslation('offers');
  const [showTooltip, setShowTooltip] = useState(false);

  const isDisabled = !hasFavorites;

  function handleToggle(value: boolean) {
    if (isDisabled) return;
    onChange(value);
  }

  function handleInfoPress() {
    setShowTooltip((prev) => !prev);
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, isDisabled && styles.labelDisabled]}>
            {t('favorites.toggle_label')}
          </Text>

          <Pressable
            onPress={handleInfoPress}
            style={styles.infoButton}
            accessibilityRole="button"
            accessibilityLabel={t('favorites.toggle_label')}
            accessibilityHint={t('favorites.info_tooltip')}
            hitSlop={SPACING.sm}
          >
            <Text style={styles.infoIcon}>ⓘ</Text>
          </Pressable>
        </View>

        <Switch
          value={enabled && hasFavorites}
          onValueChange={handleToggle}
          disabled={isDisabled}
          trackColor={{
            false: COLORS.disabled,
            true: COLORS.accent,
          }}
          thumbColor={COLORS.textPrimary}
          accessibilityLabel={t('favorites.toggle_label')}
          accessibilityState={{
            checked: enabled && hasFavorites,
            disabled: isDisabled,
          }}
        />
      </View>

      {showTooltip && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>
            {t('favorites.info_tooltip')}
          </Text>
        </View>
      )}

      {isDisabled && (
        <Text style={styles.noFavoritesText}>
          {t('favorites.no_favorites')}
        </Text>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flex: 1,
  },
  label: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  labelDisabled: {
    color: COLORS.disabled,
  },
  infoButton: {
    width: SPACING.lg,
    height: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIcon: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  tooltip: {
    backgroundColor: COLORS.accentSubtle,
    borderRadius: SPACING.sm,
    padding: SPACING.sm,
  },
  tooltipText: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  noFavoritesText: {
    fontSize: FONT_SIZE.label,
    color: COLORS.disabled,
    fontStyle: 'italic',
  },
});

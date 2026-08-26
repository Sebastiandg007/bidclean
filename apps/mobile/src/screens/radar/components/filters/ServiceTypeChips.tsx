/**
 * ServiceTypeChips — Multi-select chip UI for filtering offers by service type.
 *
 * Renders all available service types as tappable chips.
 * Selected chips are highlighted with the accent color.
 * All labels use i18n keys from radar.json (no hardcoded text).
 *
 * Requirements: 5.1
 */

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ServiceType } from '../../../offers/offers.types';
import { useRadarStore } from '../../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  chipBorder: 'rgba(255, 255, 255, 0.15)',
  chipSelectedBorder: '#00F5D4',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
} as const;

const FONT_SIZE = {
  label: 16,
  chip: 13,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const CHIP_BORDER_RADIUS = 20;
const CHIP_BORDER_WIDTH = 1;
const ACTIVE_OPACITY = 0.7;

/** All available service types in display order */
const SERVICE_TYPES: ServiceType[] = [
  'standard',
  'deep',
  'move_in_out',
  'post_construction',
  'post_event',
  'recurring',
];

/** Maps service type identifiers to i18n keys */
const SERVICE_TYPE_I18N_KEYS: Record<ServiceType, string> = {
  standard: 'filter.serviceType.standard',
  deep: 'filter.serviceType.deep',
  move_in_out: 'filter.serviceType.moveInOut',
  post_construction: 'filter.serviceType.postConstruction',
  post_event: 'filter.serviceType.postEvent',
  recurring: 'filter.serviceType.recurring',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function ServiceTypeChips(): React.JSX.Element {
  const { t } = useTranslation('radar');
  const selectedTypes = useRadarStore((state) => state.filters.serviceTypes);
  const setFilters = useRadarStore((state) => state.setFilters);

  const handleChipPress = useCallback(
    (type: ServiceType) => {
      const isSelected = selectedTypes.includes(type);
      const updated = isSelected
        ? selectedTypes.filter((st) => st !== type)
        : [...selectedTypes, type];

      setFilters({ serviceTypes: updated });
    },
    [selectedTypes, setFilters],
  );

  return (
    <View style={styles.container} testID="service-type-chips">
      <Text style={styles.label}>{t('filter.serviceType.label')}</Text>

      <View style={styles.chipContainer}>
        {SERVICE_TYPES.map((type) => {
          const isSelected = selectedTypes.includes(type);

          return (
            <TouchableOpacity
              key={type}
              style={[
                styles.chip,
                isSelected && styles.chipSelected,
              ]}
              onPress={() => handleChipPress(type)}
              activeOpacity={ACTIVE_OPACITY}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={t(SERVICE_TYPE_I18N_KEYS[type])}
              testID={`service-type-chip-${type}`}
            >
              <Text
                style={[
                  styles.chipText,
                  isSelected && styles.chipTextSelected,
                ]}
              >
                {t(SERVICE_TYPE_I18N_KEYS[type])}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: CHIP_BORDER_RADIUS,
    borderWidth: CHIP_BORDER_WIDTH,
    borderColor: COLORS.chipBorder,
    backgroundColor: 'transparent',
  },
  chipSelected: {
    borderColor: COLORS.chipSelectedBorder,
    backgroundColor: COLORS.accentSubtle,
  },
  chipText: {
    fontSize: FONT_SIZE.chip,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: COLORS.accent,
  },
});

export default ServiceTypeChips;

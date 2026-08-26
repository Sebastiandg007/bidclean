/**
 * ServiceTypePicker
 *
 * Visual card grid for selecting a cleaning service type.
 * Displays 6 service types in a 2-column grid, each with an icon
 * and i18n-translated label. Single selection with accent border
 * on the selected card.
 */

import React, { useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, FONT_SIZE, SERVICE_TYPES, SPACING } from '../offers.constants';
import type { ServiceType } from '../offers.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServiceTypePickerProps {
  /** Currently selected service type */
  selectedType?: ServiceType;
  /** Callback when a service type card is tapped */
  onSelect: (serviceType: ServiceType) => void;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const CARD_BORDER_RADIUS = 12;
const CARD_BORDER_WIDTH = 2;

// ─── Sub-Component ───────────────────────────────────────────────────────────

interface ServiceTypeCardProps {
  value: ServiceType;
  icon: string;
  labelKey: string;
  isSelected: boolean;
  onPress: (value: ServiceType) => void;
}

function ServiceTypeCard({ value, icon, labelKey, isSelected, onPress }: ServiceTypeCardProps) {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    onPress(value);
  }, [onPress, value]);

  const label = t(labelKey, { defaultValue: value });

  return (
    <View style={styles.cardWrapper}>
      <TouchableOpacity
        style={[
          styles.card,
          isSelected && styles.cardSelected,
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: isSelected }}
        testID={`service-type-card-${value}`}
      >
        <Text style={styles.icon}>{icon}</Text>
        <Text
          style={[styles.label, isSelected && styles.labelSelected]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const ServiceTypePicker: React.FC<ServiceTypePickerProps> = ({
  selectedType,
  onSelect,
}) => {
  const { t } = useTranslation();

  return (
    <View
      style={styles.container}
      accessibilityLabel={t('offers.serviceType.picker_a11y', {
        defaultValue: 'Service type selection',
      })}
    >
      <View style={styles.grid}>
        {SERVICE_TYPES.map((serviceType) => (
          <ServiceTypeCard
            key={serviceType.value}
            value={serviceType.value}
            icon={serviceType.icon}
            labelKey={serviceType.labelKey}
            isSelected={selectedType === serviceType.value}
            onPress={onSelect}
          />
        ))}
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  cardWrapper: {
    width: '48%',
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    borderWidth: CARD_BORDER_WIDTH,
    borderColor: COLORS.border,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentMuted,
  },
  icon: {
    fontSize: FONT_SIZE.icon,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  label: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    textAlign: 'center',
    fontWeight: '500',
  },
  labelSelected: {
    color: COLORS.accent,
  },
});

export default ServiceTypePicker;

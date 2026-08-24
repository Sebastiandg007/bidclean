/**
 * PropertyTypeSelector
 *
 * Visual card grid for selecting a property type. Each card displays an icon
 * (emoji) and an i18n label. Supports single selection with accent border
 * highlighting on the active card. Designed for use within property creation
 * and editing forms.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, FONT_SIZE, PROPERTY_TYPES, SPACING } from '../properties.constants';
import type { PropertyType } from '../properties.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyTypeSelectorProps {
  selected?: PropertyType;
  onChange?: (type: PropertyType) => void;
}

// ─── Icon Map ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<PropertyType, string> = {
  apartment: '🏢',
  house: '🏠',
  office: '💼',
  airbnb: '🏡',
  commercial_space: '🏪',
  other: '📍',
};

// ─── Layout Constants ────────────────────────────────────────────────────────

const CARD_BORDER_RADIUS = 12;
const CARD_BORDER_WIDTH = 1.5;
const SELECTED_BORDER_WIDTH = 2;
const CARD_MIN_HEIGHT = 96;

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface TypeCardProps {
  type: PropertyType;
  labelKey: string;
  isSelected: boolean;
  onSelect: (type: PropertyType) => void;
}

/** Individual selectable type card with icon and label */
function TypeCard({ type, labelKey, isSelected, onSelect }: TypeCardProps) {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    onSelect(type);
  }, [onSelect, type]);

  const label = t(labelKey, { defaultValue: type });

  return (
    <Pressable
      style={[
        styles.card,
        isSelected && styles.cardSelected,
      ]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={t('properties.type_selector.card_a11y', {
        defaultValue: '{{type}}, property type',
        type: label,
      })}
      testID={`property-type-card-${type}`}
    >
      <Text style={styles.cardIcon}>{TYPE_ICONS[type]}</Text>
      <Text
        style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Renders a grid of property type cards for single selection.
 *
 * @param selected - Currently selected property type
 * @param onChange - Callback invoked when user taps a type card
 */
export const PropertyTypeSelector: React.FC<PropertyTypeSelectorProps> = ({
  selected,
  onChange,
}) => {
  const handleSelect = useCallback(
    (type: PropertyType) => {
      onChange?.(type);
    },
    [onChange],
  );

  return (
    <View style={styles.container} testID="property-type-selector">
      {PROPERTY_TYPES.map((item) => (
        <TypeCard
          key={item.value}
          type={item.value}
          labelKey={item.labelKey}
          isSelected={selected === item.value}
          onSelect={handleSelect}
        />
      ))}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  card: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    borderWidth: CARD_BORDER_WIDTH,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: CARD_MIN_HEIGHT,
  },
  cardSelected: {
    borderWidth: SELECTED_BORDER_WIDTH,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSubtle,
  },
  cardIcon: {
    fontSize: FONT_SIZE.icon,
    marginBottom: SPACING.sm,
  },
  cardLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.label,
    fontWeight: '500',
    textAlign: 'center',
  },
  cardLabelSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
});

export default PropertyTypeSelector;

/**
 * PropertyTypeSelector
 *
 * Visual cards with icon and label for each property type.
 * Single selection with accent border on selected card.
 *
 * @see Task 28 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';
import type { PropertyType } from '../properties.types';

export interface PropertyTypeSelectorProps {
  selected?: PropertyType;
  onChange?: (type: PropertyType) => void;
}

export const PropertyTypeSelector: React.FC<PropertyTypeSelectorProps> = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>PropertyTypeSelector</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    padding: SPACING.md,
  },
  placeholder: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.body,
  },
});

export default PropertyTypeSelector;

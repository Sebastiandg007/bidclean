/**
 * PropertyCard
 *
 * List item card displaying property summary:
 * cover photo, name, type badge, city + country,
 * bedroom/bathroom icons with counts, offer-ready indicator.
 *
 * @see Task 26 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';
import type { PropertyListItem } from '../properties.types';

export interface PropertyCardProps {
  property: PropertyListItem;
  onPress?: (propertyId: string) => void;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({ property }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.name}>{property.name}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    padding: SPACING.md,
  },
  name: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
  },
});

export default PropertyCard;

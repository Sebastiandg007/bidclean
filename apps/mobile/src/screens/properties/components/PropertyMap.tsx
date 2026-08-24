/**
 * PropertyMap
 *
 * Mapbox MapView with draggable pin for property location.
 * Supports tap-to-place pin and triggers reverse geocoding on pin move.
 * Works as fallback when forward geocoding fails.
 *
 * @see Task 30 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';
import type { Coordinates } from '../properties.types';

export interface PropertyMapProps {
  coordinates?: Coordinates;
  onLocationChange?: (coordinates: Coordinates) => void;
  editable?: boolean;
}

export const PropertyMap: React.FC<PropertyMapProps> = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>PropertyMap (Mapbox)</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    padding: SPACING.md,
    minHeight: SPACING.xxl * 4,
  },
  placeholder: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.body,
  },
});

export default PropertyMap;

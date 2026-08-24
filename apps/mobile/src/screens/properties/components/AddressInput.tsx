/**
 * AddressInput
 *
 * Structured address form: street, city, state, postal code, country selector.
 * Includes "Locate on Map" button that triggers forward geocoding.
 * Shows fallback message when geocoding fails.
 *
 * @see Task 29 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';
import type { PropertyAddress } from '../properties.types';

export interface AddressInputProps {
  value?: Partial<PropertyAddress>;
  onChange?: (address: Partial<PropertyAddress>) => void;
  onGeocode?: () => void;
  isGeocoding?: boolean;
  geocodingError?: string | null;
}

export const AddressInput: React.FC<AddressInputProps> = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>AddressInput</Text>
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

export default AddressInput;

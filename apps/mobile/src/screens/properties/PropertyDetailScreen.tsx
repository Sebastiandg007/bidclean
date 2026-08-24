/**
 * PropertyDetailScreen
 *
 * Full property detail view with photo gallery, map, checklist,
 * requirements chips, and access instructions.
 * Includes offer-readiness indicator, Edit and Publish Offer CTAs.
 *
 * @see Task 34 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from './properties.constants';

export const PropertyDetailScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>PropertyDetailScreen</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  placeholder: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.body,
  },
});

export default PropertyDetailScreen;

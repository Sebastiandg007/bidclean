/**
 * PropertyListScreen
 *
 * Paginated list of the Host's properties with search and type filter.
 * Displays PropertyCard items in a FlatList with pull-to-refresh.
 * Includes empty state CTA and FAB for creating new properties.
 *
 * @see Task 25 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from './properties.constants';

export const PropertyListScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>PropertyListScreen</Text>
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

export default PropertyListScreen;

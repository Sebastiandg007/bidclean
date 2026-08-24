/**
 * EditPropertyScreen
 *
 * Edit form pre-populated with existing property data.
 * Same multi-step structure as CreatePropertyScreen.
 * Saves via PATCH endpoint with location_source updates.
 *
 * @see Task 35 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from './properties.constants';

export const EditPropertyScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>EditPropertyScreen</Text>
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

export default EditPropertyScreen;

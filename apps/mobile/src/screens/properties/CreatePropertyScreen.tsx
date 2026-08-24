/**
 * CreatePropertyScreen
 *
 * Multi-step form for creating a new property:
 * Step 1: Basic info + type selection
 * Step 2: Address + map (geocoding with manual pin fallback)
 * Step 3: Photos + details (checklist, requirements)
 *
 * Saves with Idempotency-Key on final step.
 *
 * @see Task 27 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from './properties.constants';

export const CreatePropertyScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>CreatePropertyScreen</Text>
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

export default CreatePropertyScreen;

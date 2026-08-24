/**
 * RequirementsChips
 *
 * Predefined chips for special requirements + custom text input.
 * Multi-select with max count validation from constants.
 * Visual distinction between predefined and custom items.
 *
 * @see Task 33 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';

export interface RequirementsChipsProps {
  selected: string[];
  onChange?: (requirements: string[]) => void;
}

export const RequirementsChips: React.FC<RequirementsChipsProps> = ({ selected }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>{`${selected.length}`}</Text>
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

export default RequirementsChips;

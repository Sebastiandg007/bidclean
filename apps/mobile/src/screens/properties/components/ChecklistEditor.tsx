/**
 * ChecklistEditor
 *
 * Add/remove/reorder checklist items for a property.
 * Validates max count and character limit per item.
 *
 * @see Task 32 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';

export interface ChecklistEditorProps {
  items: string[];
  onChange?: (items: string[]) => void;
}

export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({ items }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>{`${items.length}`}</Text>
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

export default ChecklistEditor;

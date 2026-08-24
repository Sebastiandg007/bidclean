/**
 * PhotoUploader
 *
 * Photo grid with upload button, reorder via move up/down,
 * delete with confirmation, max count indicator.
 * Uses expo-image-picker for photo selection.
 *
 * @see Task 31 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';
import type { PropertyPhoto } from '../properties.types';

export interface PhotoUploaderProps {
  photos: PropertyPhoto[];
  onUpload?: () => void;
  onDelete?: (photoId: string) => void;
  onReorder?: (photoIds: string[]) => void;
}

export const PhotoUploader: React.FC<PhotoUploaderProps> = ({ photos }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>{`${photos.length}`}</Text>
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

export default PhotoUploader;

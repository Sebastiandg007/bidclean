/**
 * PropertyPhotoGallery
 *
 * Horizontal ScrollView of property photos with tap-to-fullscreen.
 * Supports swipe navigation in full-screen modal and photo counter.
 *
 * @see Task 36 for full implementation
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../properties.constants';
import type { PropertyPhoto } from '../properties.types';

export interface PropertyPhotoGalleryProps {
  photos: PropertyPhoto[];
}

export const PropertyPhotoGallery: React.FC<PropertyPhotoGalleryProps> = ({ photos }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>
        {`${photos.length}`}
      </Text>
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

export default PropertyPhotoGallery;

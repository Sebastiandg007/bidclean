/**
 * PropertyPhotoGallery
 *
 * Reusable, self-contained horizontal photo gallery with built-in
 * full-screen ImageViewer modal. Supports swipe navigation and
 * displays a photo counter in both inline and full-screen views.
 *
 * Usage:
 * ```tsx
 * <PropertyPhotoGallery photos={property.photos} />
 * ```
 *
 * @see Task 36 — property-management spec
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, FONT_SIZE, SPACING } from '../properties.constants';
import type { PropertyPhoto } from '../properties.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyPhotoGalleryProps {
  /** Sorted array of property photos to display */
  photos: PropertyPhoto[];
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMBNAIL_WIDTH_RATIO = 0.7;
const THUMBNAIL_WIDTH = SCREEN_WIDTH * THUMBNAIL_WIDTH_RATIO;
const THUMBNAIL_HEIGHT = 180;
const THUMBNAIL_BORDER_RADIUS = 12;
const BADGE_BORDER_RADIUS = 12;
const CLOSE_BUTTON_SIZE = 36;

// ─── Sub-Components ──────────────────────────────────────────────────────────

/**
 * Empty state displayed when no photos are available.
 */
function EmptyState(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyContainer} testID="photo-gallery-empty">
      <Text style={styles.emptyIcon}>📷</Text>
      <Text style={styles.emptyText}>
        {t('properties.gallery.no_photos', { defaultValue: 'No photos available' })}
      </Text>
    </View>
  );
}

interface InlineCounterProps {
  total: number;
}

/**
 * Displays photo count below the inline gallery (e.g., "3 photos").
 */
function InlineCounter({ total }: InlineCounterProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <View style={styles.inlineCounter} testID="photo-gallery-inline-counter">
      <Text style={styles.inlineCounterText}>
        {t('properties.gallery.photo_count', {
          defaultValue: '{{count}} photos',
          count: total,
        })}
      </Text>
    </View>
  );
}

interface ThumbnailItemProps {
  photo: PropertyPhoto;
  index: number;
  total: number;
  onPress: (index: number) => void;
}

/**
 * Single tappable thumbnail in the horizontal gallery.
 */
function ThumbnailItem({ photo, index, total, onPress }: ThumbnailItemProps): React.JSX.Element {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    onPress(index);
  }, [onPress, index]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('properties.gallery.photo_tap_a11y', {
        defaultValue: 'Photo {{current}} of {{total}}, tap to view full screen',
        current: index + 1,
        total,
      })}
      testID={`photo-gallery-thumbnail-${index}`}
    >
      <Image
        source={{ uri: photo.url }}
        style={styles.thumbnail}
        resizeMode="cover"
      />
    </Pressable>
  );
}

interface FullScreenViewerProps {
  visible: boolean;
  photos: PropertyPhoto[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * Full-screen modal with horizontal swipe navigation and photo counter.
 */
function FullScreenViewer({
  visible,
  photos,
  initialIndex,
  onClose,
}: FullScreenViewerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  const handleViewableChange = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 50 }),
    [],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: SCREEN_WIDTH,
      offset: SCREEN_WIDTH * index,
      index,
    }),
    [],
  );

  const renderPhoto = useCallback(
    ({ item }: { item: PropertyPhoto }) => (
      <Image
        source={{ uri: item.url }}
        style={styles.fullScreenPhoto}
        resizeMode="contain"
      />
    ),
    [],
  );

  const keyExtractor = useCallback((item: PropertyPhoto) => item.id, []);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      testID="photo-gallery-fullscreen-modal"
    >
      <View style={styles.fullScreenContainer}>
        {/* Photo counter — top left */}
        <View style={styles.fullScreenCounter} testID="photo-gallery-fullscreen-counter">
          <Text style={styles.fullScreenCounterText}>
            {t('properties.gallery.counter', {
              defaultValue: '{{current}} / {{total}}',
              current: currentIndex + 1,
              total: photos.length,
            })}
          </Text>
        </View>

        {/* Close button — top right */}
        <Pressable
          style={styles.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('properties.gallery.close', {
            defaultValue: 'Close gallery',
          })}
          testID="photo-gallery-fullscreen-close"
        >
          <Text style={styles.closeButtonIcon}>✕</Text>
        </Pressable>

        {/* Swipeable photo list */}
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={handleViewableChange}
          viewabilityConfig={viewabilityConfig}
          keyExtractor={keyExtractor}
          renderItem={renderPhoto}
          testID="photo-gallery-fullscreen-list"
        />
      </View>
    </Modal>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Reusable property photo gallery component.
 *
 * Features:
 * - Horizontal ScrollView with snap-style thumbnails
 * - Tap any photo to open full-screen modal
 * - Swipe navigation in full-screen (paginated FlatList)
 * - Photo counter in both inline and full-screen views
 * - Empty state when no photos provided
 * - Full i18n and accessibility support
 *
 * @param props.photos - Sorted array of PropertyPhoto objects to display
 */
export const PropertyPhotoGallery: React.FC<PropertyPhotoGalleryProps> = ({ photos }) => {
  const [fullScreenVisible, setFullScreenVisible] = useState(false);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);

  const handlePhotoPress = useCallback((index: number) => {
    setFullScreenIndex(index);
    setFullScreenVisible(true);
  }, []);

  const handleCloseFullScreen = useCallback(() => {
    setFullScreenVisible(false);
  }, []);

  if (photos.length === 0) {
    return <EmptyState />;
  }

  return (
    <View style={styles.container} testID="photo-gallery">
      {/* Horizontal thumbnail gallery */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={THUMBNAIL_WIDTH + SPACING.sm}
        snapToAlignment="start"
        accessibilityRole="adjustable"
        accessibilityLabel={t('properties.gallery.scroll_a11y', {
          defaultValue: 'Property photos, swipe to browse',
        })}
        testID="photo-gallery-scroll"
      >
        {photos.map((photo, index) => (
          <ThumbnailItem
            key={photo.id}
            photo={photo}
            index={index}
            total={photos.length}
            onPress={handlePhotoPress}
          />
        ))}
      </ScrollView>

      {/* Inline photo counter */}
      <InlineCounter total={photos.length} />

      {/* Full-screen viewer modal */}
      <FullScreenViewer
        visible={fullScreenVisible}
        photos={photos}
        initialIndex={fullScreenIndex}
        onClose={handleCloseFullScreen}
      />
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
  },

  // ─── Inline Gallery ─────────────────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderRadius: THUMBNAIL_BORDER_RADIUS,
  },

  // ─── Inline Counter ─────────────────────────────────────────────────────
  inlineCounter: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  inlineCounterText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
  },

  // ─── Empty State ────────────────────────────────────────────────────────
  emptyContainer: {
    height: THUMBNAIL_HEIGHT,
    backgroundColor: COLORS.card,
    borderRadius: THUMBNAIL_BORDER_RADIUS,
    marginHorizontal: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: FONT_SIZE.icon,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
  },

  // ─── Full-Screen Modal ──────────────────────────────────────────────────
  fullScreenContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
  },
  fullScreenCounter: {
    position: 'absolute',
    top: SPACING.xxl,
    left: SPACING.md,
    zIndex: 10,
    backgroundColor: COLORS.card,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  fullScreenCounterText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    top: SPACING.xxl,
    right: SPACING.md,
    zIndex: 10,
    width: CLOSE_BUTTON_SIZE,
    height: CLOSE_BUTTON_SIZE,
    borderRadius: CLOSE_BUTTON_SIZE / 2,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonIcon: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
  },
  fullScreenPhoto: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
});

export default PropertyPhotoGallery;

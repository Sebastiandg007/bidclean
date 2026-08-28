/**
 * PhotoUploader
 *
 * Photo grid (2 columns) with upload button, reorder via move up/down,
 * delete with confirmation, max count indicator, and mime_type/size info.
 * Uses expo-image-picker for photo selection from device library.
 *
 * @see Task 31 — property-management spec
 */

import React, { useCallback } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import {
  COLORS,
  FONT_SIZE,
  PROPERTY_MAX_PHOTOS,
  PROPERTY_PHOTO_MAX_SIZE_MB,
  SPACING,
} from '../properties.constants';
import type { PropertyPhoto } from '../properties.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PhotoUploaderProps {
  photos: PropertyPhoto[];
  onUpload?: (uri: string) => void;
  onDelete?: (photoId: string) => void;
  onReorder?: (photoIds: string[]) => void;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const NUM_COLUMNS = 2;
const GRID_GAP = SPACING.sm;
const THUMBNAIL_ASPECT_RATIO = 1;
const BADGE_BORDER_RADIUS = 6;
const ACTION_BUTTON_SIZE = 28;
const BYTES_PER_MB = 1024 * 1024;
const IMAGE_QUALITY = 0.8;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format bytes to a human-readable MB string */
function formatFileSize(bytes: number): string {
  const mb = bytes / BYTES_PER_MB;
  return `${mb.toFixed(1)} MB`;
}

/** Get sorted photos by displayOrder */
function getSortedPhotos(photos: PropertyPhoto[]): PropertyPhoto[] {
  return [...photos].sort((a, b) => a.displayOrder - b.displayOrder);
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface CountIndicatorProps {
  current: number;
  max: number;
}

/** Shows "X/MAX photos" counter */
function CountIndicator({ current, max }: CountIndicatorProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.countContainer} testID="photo-count-indicator">
      <Text style={styles.countText}>
        {t('properties.photos.count', {
          defaultValue: '{{current}}/{{max}} photos',
          current,
          max,
        })}
      </Text>
    </View>
  );
}

/** Badge displayed on the first photo (cover) */
function CoverBadge() {
  const { t } = useTranslation();

  return (
    <View style={styles.coverBadge} testID="photo-cover-badge">
      <Text style={styles.coverBadgeText}>
        {t('properties.photos.cover', { defaultValue: 'Cover' })}
      </Text>
    </View>
  );
}

interface PhotoInfoProps {
  mimeType: string;
  fileSizeBytes: number;
}

/** Displays mime type and file size below the thumbnail */
function PhotoInfo({ mimeType, fileSizeBytes }: PhotoInfoProps) {
  return (
    <Text style={styles.photoInfo} numberOfLines={1}>
      {mimeType} • {formatFileSize(fileSizeBytes)}
    </Text>
  );
}

interface ReorderButtonsProps {
  photoId: string;
  index: number;
  total: number;
  onMoveUp: (photoId: string) => void;
  onMoveDown: (photoId: string) => void;
}

/** Move up/down buttons for reordering photos */
function ReorderButtons({
  photoId,
  index,
  total,
  onMoveUp,
  onMoveDown,
}: ReorderButtonsProps) {
  const { t } = useTranslation();
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <View style={styles.reorderContainer}>
      <Pressable
        style={[styles.actionButton, isFirst && styles.actionButtonDisabled]}
        onPress={() => onMoveUp(photoId)}
        disabled={isFirst}
        accessibilityRole="button"
        accessibilityLabel={t('properties.photos.move_up', {
          defaultValue: 'Move photo up',
        })}
        testID={`photo-move-up-${photoId}`}
      >
        <Text style={[styles.actionIcon, isFirst && styles.actionIconDisabled]}>↑</Text>
      </Pressable>
      <Pressable
        style={[styles.actionButton, isLast && styles.actionButtonDisabled]}
        onPress={() => onMoveDown(photoId)}
        disabled={isLast}
        accessibilityRole="button"
        accessibilityLabel={t('properties.photos.move_down', {
          defaultValue: 'Move photo down',
        })}
        testID={`photo-move-down-${photoId}`}
      >
        <Text style={[styles.actionIcon, isLast && styles.actionIconDisabled]}>↓</Text>
      </Pressable>
    </View>
  );
}

interface DeleteButtonProps {
  photoId: string;
  onDelete: (photoId: string) => void;
}

/** Delete button with confirmation alert */
function DeleteButton({ photoId, onDelete }: DeleteButtonProps) {
  const { t } = useTranslation();

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('properties.photos.delete_title', { defaultValue: 'Delete Photo' }),
      t('properties.photos.delete_message', {
        defaultValue: 'Are you sure you want to delete this photo?',
      }),
      [
        {
          text: t('properties.photos.delete_cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('properties.photos.delete_confirm', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: () => onDelete(photoId),
        },
      ],
    );
  }, [photoId, onDelete, t]);

  return (
    <Pressable
      style={styles.deleteButton}
      onPress={handleDelete}
      accessibilityRole="button"
      accessibilityLabel={t('properties.photos.delete_a11y', {
        defaultValue: 'Delete photo',
      })}
      testID={`photo-delete-${photoId}`}
    >
      <Text style={styles.deleteIcon}>✕</Text>
    </Pressable>
  );
}

interface PhotoTileProps {
  photo: PropertyPhoto;
  index: number;
  total: number;
  onMoveUp: (photoId: string) => void;
  onMoveDown: (photoId: string) => void;
  onDelete: (photoId: string) => void;
}

/** Single photo tile with thumbnail, info, reorder, and delete controls */
function PhotoTile({
  photo,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDelete,
}: PhotoTileProps) {
  const { t } = useTranslation();
  const isCover = index === 0;

  return (
    <View style={styles.photoTile} testID={`photo-tile-${photo.id}`}>
      <View style={styles.thumbnailContainer}>
        <Image
          source={{ uri: photo.url }}
          style={styles.thumbnail}
          resizeMode="cover"
          accessibilityLabel={t('properties.photos.thumbnail_a11y', {
            defaultValue: 'Property photo {{index}}',
            index: index + 1,
          })}
        />
        {isCover && <CoverBadge />}
        <DeleteButton photoId={photo.id} onDelete={onDelete} />
      </View>

      <PhotoInfo mimeType={photo.mimeType} fileSizeBytes={photo.fileSizeBytes} />

      <ReorderButtons
        photoId={photo.id}
        index={index}
        total={total}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      />
    </View>
  );
}

interface UploadButtonProps {
  disabled: boolean;
  onPress: () => void;
}

/** Upload tile that triggers expo-image-picker */
function UploadButton({ disabled, onPress }: UploadButtonProps) {
  const { t } = useTranslation();

  return (
    <Pressable
      style={[styles.uploadTile, disabled && styles.uploadTileDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t('properties.photos.upload_a11y', {
        defaultValue: 'Upload a photo',
      })}
      accessibilityState={{ disabled }}
      testID="photo-upload-button"
    >
      <Text style={[styles.uploadIcon, disabled && styles.uploadIconDisabled]}>+</Text>
      <Text style={[styles.uploadText, disabled && styles.uploadTextDisabled]}>
        {t('properties.photos.upload', { defaultValue: 'Add Photo' })}
      </Text>
      {disabled && (
        <Text style={styles.uploadLimitText}>
          {t('properties.photos.limit_reached', { defaultValue: 'Limit reached' })}
        </Text>
      )}
    </Pressable>
  );
}

/** Empty state when no photos exist */
function EmptyState() {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyState} testID="photo-empty-state">
      <Text style={styles.emptyIcon}>📷</Text>
      <Text style={styles.emptyTitle}>
        {t('properties.photos.empty_title', { defaultValue: 'No photos yet' })}
      </Text>
      <Text style={styles.emptySubtitle}>
        {t('properties.photos.empty_subtitle', {
          defaultValue: 'Add photos to showcase your property',
        })}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Photo grid uploader with reorder, delete, and metadata display.
 *
 * @param photos - Array of property photos sorted by displayOrder
 * @param onUpload - Callback with image URI when a photo is selected
 * @param onDelete - Callback with photo ID when deletion is confirmed
 * @param onReorder - Callback with new ordered array of photo IDs
 */
export const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  photos,
  onUpload,
  onDelete,
  onReorder,
}) => {
  const { t } = useTranslation();
  const sortedPhotos = getSortedPhotos(photos);
  const photoCount = sortedPhotos.length;
  const isMaxReached = photoCount >= PROPERTY_MAX_PHOTOS;

  const handleUpload = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: IMAGE_QUALITY,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    if (!asset) return;
    const fileSizeBytes = asset.fileSize ?? 0;
    const maxBytes = PROPERTY_PHOTO_MAX_SIZE_MB * BYTES_PER_MB;

    if (fileSizeBytes > maxBytes) {
      Alert.alert(
        t('properties.photos.size_error_title', { defaultValue: 'File Too Large' }),
        t('properties.photos.size_error_message', {
          defaultValue: 'Photo must be under {{max}} MB',
          max: PROPERTY_PHOTO_MAX_SIZE_MB,
        }),
      );
      return;
    }

    onUpload?.(asset.uri);
  }, [onUpload, t]);

  const handleMoveUp = useCallback(
    (photoId: string) => {
      const ids = sortedPhotos.map((p) => p.id);
      const currentIndex = ids.indexOf(photoId);
      if (currentIndex <= 0) return;

      const reordered = [...ids];
      const prev = reordered[currentIndex - 1]!;
      const current = reordered[currentIndex]!;
      reordered[currentIndex - 1] = current;
      reordered[currentIndex] = prev;
      onReorder?.(reordered);
    },
    [sortedPhotos, onReorder],
  );

  const handleMoveDown = useCallback(
    (photoId: string) => {
      const ids = sortedPhotos.map((p) => p.id);
      const currentIndex = ids.indexOf(photoId);
      if (currentIndex < 0 || currentIndex >= ids.length - 1) return;

      const reordered = [...ids];
      const current = reordered[currentIndex]!;
      const next = reordered[currentIndex + 1]!;
      reordered[currentIndex] = next;
      reordered[currentIndex + 1] = current;
      onReorder?.(reordered);
    },
    [sortedPhotos, onReorder],
  );

  const handleDelete = useCallback(
    (photoId: string) => {
      onDelete?.(photoId);
    },
    [onDelete],
  );

  const renderPhotoItem = useCallback(
    ({ item, index }: { item: PropertyPhoto; index: number }) => (
      <PhotoTile
        photo={item}
        index={index}
        total={photoCount}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onDelete={handleDelete}
      />
    ),
    [photoCount, handleMoveUp, handleMoveDown, handleDelete],
  );

  const keyExtractor = useCallback((item: PropertyPhoto) => item.id, []);

  return (
    <View style={styles.container} testID="photo-uploader">
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>
          {t('properties.photos.title', { defaultValue: 'Photos' })}
        </Text>
        <CountIndicator current={photoCount} max={PROPERTY_MAX_PHOTOS} />
      </View>

      {photoCount === 0 ? (
        <>
          <EmptyState />
          <UploadButton disabled={isMaxReached} onPress={handleUpload} />
        </>
      ) : (
        <>
          <FlatList
            data={sortedPhotos}
            renderItem={renderPhotoItem}
            keyExtractor={keyExtractor}
            numColumns={NUM_COLUMNS}
            columnWrapperStyle={styles.row}
            scrollEnabled={false}
            contentContainerStyle={styles.grid}
          />
          <UploadButton disabled={isMaxReached} onPress={handleUpload} />
        </>
      )}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm + SPACING.xs,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
  },
  countContainer: {
    backgroundColor: COLORS.accentSubtle,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  countText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
  },
  grid: {
    gap: GRID_GAP,
  },
  row: {
    gap: GRID_GAP,
  },
  photoTile: {
    flex: 1,
    maxWidth: '48%',
  },
  thumbnailContainer: {
    aspectRatio: THUMBNAIL_ASPECT_RATIO,
    borderRadius: SPACING.sm,
    overflow: 'hidden',
    backgroundColor: COLORS.background,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  coverBadge: {
    position: 'absolute',
    top: SPACING.xs,
    left: SPACING.xs,
    backgroundColor: COLORS.accent,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  coverBadgeText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
  },
  deleteButton: {
    position: 'absolute',
    top: SPACING.xs,
    right: SPACING.xs,
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderRadius: ACTION_BUTTON_SIZE / 2,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteIcon: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
  },
  photoInfo: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
    marginTop: SPACING.xs,
  },
  reorderContainer: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  actionButton: {
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderRadius: BADGE_BORDER_RADIUS,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionButtonDisabled: {
    opacity: 0.3,
  },
  actionIcon: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.label,
    fontWeight: '700',
  },
  actionIconDisabled: {
    color: COLORS.textSecondary,
  },
  uploadTile: {
    marginTop: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    borderRadius: SPACING.sm,
    paddingVertical: SPACING.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadTileDisabled: {
    borderColor: COLORS.border,
  },
  uploadIcon: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.title,
    fontWeight: '300',
    marginBottom: SPACING.xs,
  },
  uploadIconDisabled: {
    color: COLORS.textSecondary,
  },
  uploadText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
  },
  uploadTextDisabled: {
    color: COLORS.textSecondary,
  },
  uploadLimitText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
    marginTop: SPACING.xs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  emptyIcon: {
    fontSize: FONT_SIZE.icon,
    marginBottom: SPACING.sm,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  emptySubtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
    textAlign: 'center',
  },
});

export default PhotoUploader;

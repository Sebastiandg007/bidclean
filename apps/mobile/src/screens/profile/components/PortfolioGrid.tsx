/**
 * PortfolioGrid — Photo grid with upload action and lazy loading.
 * Displays portfolio photos in a responsive grid layout (3 columns).
 * Supports reorder via move up/down and delete with confirmation.
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles, useTheme } from '../../../theme';
import type { PortfolioPhoto } from '../profile.types';
import { PORTFOLIO } from '../profile.constants';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

const GRID_COLUMNS = 3;
const GRID_GAP = SPACING.sm;
const BORDER_RADIUS = 8;

// ─── Types ───────────────────────────────────────────────────────────────────

interface PortfolioGridProps {
  photos: PortfolioPhoto[];
  isLoading: boolean;
  isUploading: boolean;
  hasMore: boolean;
  onUpload: () => void;
  onDelete: (photoId: string) => void;
  onMoveUp: (photoId: string) => void;
  onMoveDown: (photoId: string) => void;
  onLoadMore: () => void;
}

interface PhotoItemProps {
  photo: PortfolioPhoto;
  isFirst: boolean;
  isLast: boolean;
  onDelete: (photoId: string) => void;
  onMoveUp: (photoId: string) => void;
  onMoveDown: (photoId: string) => void;
}

interface UploadButtonProps {
  onPress: () => void;
  disabled: boolean;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function PhotoItem({
  photo,
  isFirst,
  isLast,
  onDelete,
  onMoveUp,
  onMoveDown,
}: PhotoItemProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();

  const handleDelete = useCallback(() => {
    onDelete(photo.id);
  }, [onDelete, photo.id]);

  const handleMoveUp = useCallback(() => {
    onMoveUp(photo.id);
  }, [onMoveUp, photo.id]);

  const handleMoveDown = useCallback(() => {
    onMoveDown(photo.id);
  }, [onMoveDown, photo.id]);

  return (
    <View style={styles.photoContainer} testID={`portfolio-photo-${photo.id}`}>
      <Image source={{ uri: photo.url }} style={styles.photo} />
      <View style={styles.photoOverlay}>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
          testID={`portfolio-delete-${photo.id}`}
          accessibilityLabel={t('profile.portfolio.delete_confirm')}
        >
          <Text style={styles.deleteIcon}>✕</Text>
        </TouchableOpacity>
        <View style={styles.reorderControls}>
          {!isFirst && (
            <TouchableOpacity
              style={styles.reorderButton}
              onPress={handleMoveUp}
              testID={`portfolio-move-up-${photo.id}`}
              accessibilityLabel={t('profile.portfolio.move_up')}
            >
              <Text style={styles.reorderIcon}>▲</Text>
            </TouchableOpacity>
          )}
          {!isLast && (
            <TouchableOpacity
              style={styles.reorderButton}
              onPress={handleMoveDown}
              testID={`portfolio-move-down-${photo.id}`}
              accessibilityLabel={t('profile.portfolio.move_down')}
            >
              <Text style={styles.reorderIcon}>▼</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function UploadButton({ onPress, disabled }: UploadButtonProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <TouchableOpacity
      style={[styles.uploadButton, disabled && styles.uploadButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      testID="portfolio-upload-button"
      accessibilityLabel={t('profile.portfolio.upload')}
    >
      <Text style={[styles.uploadIcon, disabled && styles.uploadIconDisabled]}>+</Text>
      <Text style={[styles.uploadLabel, disabled && styles.uploadLabelDisabled]}>
        {t('profile.portfolio.upload')}
      </Text>
    </TouchableOpacity>
  );
}

function EmptyState(): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <View style={styles.emptyState} testID="portfolio-empty-state">
      <Text style={styles.emptyTitle}>{t('profile.portfolio.empty_title')}</Text>
      <Text style={styles.emptyDescription}>
        {t('profile.portfolio.empty_description')}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PortfolioGrid({
  photos,
  isLoading,
  isUploading,
  hasMore,
  onUpload,
  onDelete,
  onMoveUp,
  onMoveDown,
  onLoadMore,
}: PortfolioGridProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { theme } = useTheme();
  const isMaxReached = photos.length >= PORTFOLIO.MAX_PHOTOS;

  const renderItem = useCallback(
    ({ item, index }: { item: PortfolioPhoto | 'upload'; index: number }) => {
      if (item === 'upload') {
        return <UploadButton onPress={onUpload} disabled={isMaxReached || isUploading} />;
      }

      return (
        <PhotoItem
          photo={item}
          isFirst={index === 0}
          isLast={index === photos.length - 1}
          onDelete={onDelete}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      );
    },
    [onUpload, onDelete, onMoveUp, onMoveDown, isMaxReached, isUploading, photos.length],
  );

  const keyExtractor = useCallback(
    (item: PortfolioPhoto | 'upload') => (item === 'upload' ? 'upload-btn' : item.id),
    [],
  );

  const renderFooter = useCallback(() => {
    if (isLoading && photos.length > 0) {
      return (
        <View style={styles.footer} testID="portfolio-loading-more">
          <ActivityIndicator color={theme.accent} />
        </View>
      );
    }
    return null;
  }, [isLoading, photos.length]);

  const gridData: (PortfolioPhoto | 'upload')[] = [
    ...photos,
    ...(!isMaxReached ? (['upload'] as const) : []),
  ];

  if (isLoading && photos.length === 0) {
    return (
      <View style={styles.loadingContainer} testID="portfolio-loading">
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.loadingText}>{t('profile.portfolio.loading')}</Text>
      </View>
    );
  }

  if (!isLoading && photos.length === 0) {
    return (
      <View>
        <EmptyState />
        <View style={styles.uploadAloneContainer}>
          <UploadButton onPress={onUpload} disabled={isUploading} />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={gridData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={GRID_COLUMNS}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.gridContent}
      onEndReached={hasMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.5}
      ListFooterComponent={renderFooter}
      showsVerticalScrollIndicator={false}
      testID="portfolio-grid"
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  gridContent: {
    paddingBottom: SPACING.md,
  },
  row: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  photoContainer: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: BORDER_RADIUS,
    overflow: 'hidden',
    backgroundColor: theme.surface,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: SPACING.xs,
  },
  deleteButton: {
    backgroundColor: theme.danger,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteIcon: {
    color: theme.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  reorderControls: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  reorderButton: {
    backgroundColor: theme.overlay,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reorderIcon: {
    color: theme.textPrimary,
    fontSize: 10,
  },
  uploadButton: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: BORDER_RADIUS,
    borderWidth: 2,
    borderColor: theme.accent,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.surface,
  },
  uploadButtonDisabled: {
    borderColor: theme.textSecondary,
    opacity: 0.5,
  },
  uploadIcon: {
    fontSize: 32,
    color: theme.accent,
    fontWeight: '300',
  },
  uploadIconDisabled: {
    color: theme.textSecondary,
  },
  uploadLabel: {
    fontSize: 11,
    color: theme.accent,
    marginTop: SPACING.xs,
  },
  uploadLabelDisabled: {
    color: theme.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.md * 2,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.textPrimary,
    marginBottom: SPACING.sm,
  },
  emptyDescription: {
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  uploadAloneContainer: {
    width: 120,
    alignSelf: 'center',
    marginTop: SPACING.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.md * 3,
  },
  loadingText: {
    color: theme.textSecondary,
    marginTop: SPACING.sm,
    fontSize: 14,
  },
  footer: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
}));

export default PortfolioGrid;

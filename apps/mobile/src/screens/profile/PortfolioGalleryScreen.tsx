/**
 * PortfolioGalleryScreen — Cleaner portfolio photo management.
 * Grid display with upload, reorder via move up/down, delete with confirmation.
 * Supports lazy loading with pagination.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { PortfolioGrid } from './components/PortfolioGrid';
import { PORTFOLIO, PROFILE_PHOTO } from './profile.constants';
import type { PortfolioPhoto } from './profile.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  accent: '#00F5D4',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  sm: 13,
  xl: 24,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const ENDPOINTS = {
  PORTFOLIO: '/profile/me/portfolio',
} as const;

const PAGE_SIZE = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getApiClient() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { apiClient } = require('../../services/api.service') as {
    apiClient: {
      get: <T>(url: string) => Promise<{ data: T }>;
      post: <T>(url: string, data?: unknown, config?: Record<string, unknown>) => Promise<{ data: T }>;
      delete: (url: string) => Promise<{ data: unknown }>;
    };
  };
  return apiClient;
}

function extractErrorMessage(err: unknown, fallbackKey: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallbackKey;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PortfolioGalleryScreen(): React.JSX.Element {
  const { t } = useTranslation();

  const [photos, setPhotos] = useState<PortfolioPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchPhotos = useCallback(async (page: number, append: boolean) => {
    setIsLoading(true);

    try {
      const client = getApiClient();
      const response = await client.get<PortfolioPhoto[]>(
        `${ENDPOINTS.PORTFOLIO}?page=${page}&limit=${PAGE_SIZE}`,
      );

      const fetched = response.data;
      setPhotos((prev) => (append ? [...prev, ...fetched] : fetched));
      setHasMore(fetched.length >= PAGE_SIZE);
    } catch (err) {
      const message = extractErrorMessage(err, t('profile.portfolio.error.load_failed'));
      Alert.alert(t('profile.portfolio.title'), message);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPhotos(1, false);
  }, [fetchPhotos]);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchPhotos(nextPage, true);
    }
  }, [isLoading, hasMore, currentPage, fetchPhotos]);

  const handleUpload = useCallback(async () => {
    if (photos.length >= PORTFOLIO.MAX_PHOTOS) {
      Alert.alert(
        t('profile.portfolio.title'),
        t('profile.portfolio.max_reached', { max: PORTFOLIO.MAX_PHOTOS }),
      );
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets?.[0]) {
      return;
    }

    const asset = result.assets[0];
    setIsUploading(true);

    try {
      const client = getApiClient();
      const formData = new FormData();

      formData.append('file', {
        uri: asset.uri,
        type: asset.mimeType ?? 'image/jpeg',
        name: `portfolio_${Date.now()}.jpg`,
      } as unknown as Blob);

      const response = await client.post<PortfolioPhoto>(
        ENDPOINTS.PORTFOLIO,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: PROFILE_PHOTO.UPLOAD_TIMEOUT_MS,
        },
      );

      setPhotos((prev) => [...prev, response.data]);
    } catch (err) {
      const message = extractErrorMessage(err, t('profile.portfolio.error.upload_failed'));
      Alert.alert(t('profile.portfolio.title'), message);
    } finally {
      setIsUploading(false);
    }
  }, [photos.length, t]);

  const handleDelete = useCallback(
    (photoId: string) => {
      Alert.alert(
        t('profile.portfolio.delete_title'),
        t('profile.portfolio.delete_message'),
        [
          { text: t('profile.portfolio.delete_cancel'), style: 'cancel' },
          {
            text: t('profile.portfolio.delete_confirm'),
            style: 'destructive',
            onPress: async () => {
              try {
                const client = getApiClient();
                await client.delete(`${ENDPOINTS.PORTFOLIO}/${photoId}`);
                setPhotos((prev) => prev.filter((p) => p.id !== photoId));
              } catch (err) {
                const message = extractErrorMessage(
                  err,
                  t('profile.portfolio.error.delete_failed'),
                );
                Alert.alert(t('profile.portfolio.title'), message);
              }
            },
          },
        ],
      );
    },
    [t],
  );

  const handleMoveUp = useCallback(
    (photoId: string) => {
      setPhotos((prev) => {
        const index = prev.findIndex((p) => p.id === photoId);
        if (index <= 0) return prev;

        const updated = [...prev];
        [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
        return updated;
      });
    },
    [],
  );

  const handleMoveDown = useCallback(
    (photoId: string) => {
      setPhotos((prev) => {
        const index = prev.findIndex((p) => p.id === photoId);
        if (index < 0 || index >= prev.length - 1) return prev;

        const updated = [...prev];
        [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
        return updated;
      });
    },
    [],
  );

  const isMaxReached = photos.length >= PORTFOLIO.MAX_PHOTOS;

  return (
    <SafeAreaView style={styles.safeArea} testID="portfolio-gallery-screen">
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('profile.portfolio.title')}</Text>
          <Text style={styles.photoCount}>
            {t('profile.portfolio.photo_count', {
              count: photos.length,
              max: PORTFOLIO.MAX_PHOTOS,
            })}
          </Text>
        </View>

        {/* Max reached banner */}
        {isMaxReached && (
          <View style={styles.maxBanner} testID="portfolio-max-reached">
            <Text style={styles.maxBannerText}>
              {t('profile.portfolio.max_reached', { max: PORTFOLIO.MAX_PHOTOS })}
            </Text>
          </View>
        )}

        {/* Portfolio Grid */}
        <PortfolioGrid
          photos={photos}
          isLoading={isLoading}
          isUploading={isUploading}
          hasMore={hasMore}
          onUpload={handleUpload}
          onDelete={handleDelete}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onLoadMore={handleLoadMore}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  headerTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  photoCount: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  maxBanner: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  maxBannerText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default PortfolioGalleryScreen;

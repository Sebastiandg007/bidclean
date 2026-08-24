/**
 * PropertyDetailScreen
 *
 * Full property detail view with inline photo gallery, map, info cards,
 * checklist, requirements chips, access instructions, and action buttons.
 * Includes offer-readiness indicator, Edit and Publish Offer CTAs.
 *
 * Sub-components are extracted for readability (max 20-30 lines each).
 * All text uses i18n keys via useTranslation().
 *
 * @see Task 34 — property-management spec
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { COLORS, FONT_SIZE, SPACING, PREDEFINED_REQUIREMENTS } from './properties.constants';
import type { Property, PropertyPhoto } from './properties.types';
import { useProperties } from './useProperties';
import { PropertyMap } from './components/PropertyMap';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyDetailScreenProps {
  /** Property ID passed via route params */
  propertyId: string;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const GALLERY_PHOTO_WIDTH_RATIO = 0.75;
const GALLERY_PHOTO_WIDTH = SCREEN_WIDTH * GALLERY_PHOTO_WIDTH_RATIO;
const GALLERY_PHOTO_HEIGHT = 200;
const CARD_BORDER_RADIUS = 12;
const BADGE_BORDER_RADIUS = 12;
const CHIP_BORDER_RADIUS = 20;
const OFFER_DOT_SIZE = 10;
const FULLSCREEN_CLOSE_SIZE = 36;
const INFO_CARD_COLUMNS = 3;
const DESCRIPTION_LINE_HEIGHT = 22;
const ACCESS_TEXT_LINE_HEIGHT = 20;

// ─── Sub-Components: Loading & Error ─────────────────────────────────────────

/** Loading spinner centered on screen */
function LoadingState() {
  const { t } = useTranslation();

  return (
    <View style={styles.centered} testID="property-detail-loading">
      <ActivityIndicator
        size="large"
        color={COLORS.accent}
        accessibilityLabel={t('properties.detail.loading', {
          defaultValue: 'Loading property details',
        })}
      />
    </View>
  );
}

interface ErrorStateProps {
  message: string | null;
  onRetry: () => void;
}

/** Error view with retry button */
function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.centered} testID="property-detail-error">
      <Text style={styles.errorIcon}>⚠️</Text>
      <Text style={styles.errorText}>
        {message ?? t('properties.detail.error_generic', {
          defaultValue: 'Failed to load property',
        })}
      </Text>
      <Pressable
        style={styles.retryButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t('properties.detail.retry', { defaultValue: 'Retry' })}
        testID="property-detail-retry"
      >
        <Text style={styles.retryButtonText}>
          {t('properties.detail.retry', { defaultValue: 'Retry' })}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Sub-Components: Photo Gallery ───────────────────────────────────────────

interface PhotoGalleryProps {
  photos: PropertyPhoto[];
  onPhotoPress: (index: number) => void;
}

/** Horizontal scrollable photo gallery with empty state */
function PhotoGallery({ photos, onPhotoPress }: PhotoGalleryProps) {
  const { t } = useTranslation();

  if (photos.length === 0) {
    return (
      <View style={styles.galleryEmpty} testID="property-detail-gallery-empty">
        <Text style={styles.galleryEmptyIcon}>📷</Text>
        <Text style={styles.galleryEmptyText}>
          {t('properties.detail.no_photos', { defaultValue: 'No photos yet' })}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.galleryScroll}
      accessibilityRole="adjustable"
      accessibilityLabel={t('properties.detail.gallery_a11y', {
        defaultValue: 'Property photos, swipe to browse',
      })}
      testID="property-detail-gallery"
    >
      {photos.map((photo, index) => (
        <Pressable
          key={photo.id}
          onPress={() => onPhotoPress(index)}
          accessibilityRole="button"
          accessibilityLabel={t('properties.detail.photo_a11y', {
            defaultValue: 'Photo {{index}} of {{total}}, tap to view full screen',
            index: index + 1,
            total: photos.length,
          })}
          testID={`property-detail-photo-${index}`}
        >
          <Image
            source={{ uri: photo.url }}
            style={styles.galleryPhoto}
            resizeMode="cover"
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}

interface FullScreenGalleryProps {
  visible: boolean;
  photos: PropertyPhoto[];
  initialIndex: number;
  onClose: () => void;
}

/** Full-screen photo modal with swipe navigation and counter */
function FullScreenGallery({ visible, photos, initialIndex, onClose }: FullScreenGalleryProps) {
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

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 50 }), []);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      testID="property-detail-fullscreen-modal"
    >
      <View style={styles.fullScreenContainer}>
        {/* Close button */}
        <Pressable
          style={styles.fullScreenClose}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('properties.detail.close_gallery', {
            defaultValue: 'Close gallery',
          })}
          testID="property-detail-fullscreen-close"
        >
          <Text style={styles.fullScreenCloseIcon}>✕</Text>
        </Pressable>

        {/* Photo counter */}
        <View style={styles.photoCounter} testID="property-detail-photo-counter">
          <Text style={styles.photoCounterText}>
            {t('properties.detail.photo_counter', {
              defaultValue: '{{current}} / {{total}}',
              current: currentIndex + 1,
              total: photos.length,
            })}
          </Text>
        </View>

        {/* Swipeable FlatList */}
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onViewableItemsChanged={handleViewableChange}
          viewabilityConfig={viewabilityConfig}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.url }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
            />
          )}
          testID="property-detail-fullscreen-list"
        />
      </View>
    </Modal>
  );
}

// ─── Sub-Components: Offer Readiness ─────────────────────────────────────────

interface OfferReadinessIndicatorProps {
  isReady: boolean;
}

/** Badge indicating whether the property is ready for offers */
function OfferReadinessIndicator({ isReady }: OfferReadinessIndicatorProps) {
  const { t } = useTranslation();

  const label = isReady
    ? t('properties.detail.offer_ready', { defaultValue: 'Ready for offers' })
    : t('properties.detail.offer_not_ready', { defaultValue: 'Not ready for offers' });

  return (
    <View
      style={[styles.offerBadge, isReady ? styles.offerBadgeReady : styles.offerBadgeWarning]}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID="property-detail-offer-readiness"
    >
      <View
        style={[styles.offerDot, isReady ? styles.offerDotReady : styles.offerDotWarning]}
      />
      <Text style={[styles.offerBadgeText, isReady ? styles.offerTextReady : styles.offerTextWarning]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Sub-Components: Info Cards ──────────────────────────────────────────────

interface InfoCardProps {
  icon: string;
  label: string;
  value: string;
  testID: string;
}

/** Small info card showing an icon, label, and value */
function InfoCard({ icon, label, value, testID }: InfoCardProps) {
  return (
    <View style={styles.infoCard} accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

interface InfoCardsGridProps {
  property: Property;
}

/** Grid of info cards for dimensions, rooms, etc. */
function InfoCardsGrid({ property }: InfoCardsGridProps) {
  const { t } = useTranslation();

  const cards: Array<{ icon: string; label: string; value: string; testID: string }> = [
    {
      icon: '📐',
      label: t('properties.detail.sqm', { defaultValue: 'Area' }),
      value: t('properties.detail.sqm_value', { defaultValue: '{{value}} m²', value: property.squareMeters }),
      testID: 'info-card-sqm',
    },
    {
      icon: '🛏️',
      label: t('properties.detail.bedrooms', { defaultValue: 'Bedrooms' }),
      value: `${property.bedrooms}`,
      testID: 'info-card-bedrooms',
    },
    {
      icon: '🚿',
      label: t('properties.detail.bathrooms', { defaultValue: 'Bathrooms' }),
      value: `${property.bathrooms}`,
      testID: 'info-card-bathrooms',
    },
    {
      icon: '🏢',
      label: t('properties.detail.floor', { defaultValue: 'Floor' }),
      value: property.floorNumber !== null
        ? `${property.floorNumber}`
        : t('properties.detail.not_specified', { defaultValue: 'N/A' }),
      testID: 'info-card-floor',
    },
    {
      icon: '🚗',
      label: t('properties.detail.parking', { defaultValue: 'Parking' }),
      value: property.hasParking
        ? t('properties.detail.yes', { defaultValue: 'Yes' })
        : t('properties.detail.no', { defaultValue: 'No' }),
      testID: 'info-card-parking',
    },
    {
      icon: '🛗',
      label: t('properties.detail.elevator', { defaultValue: 'Elevator' }),
      value: property.hasElevator
        ? t('properties.detail.yes', { defaultValue: 'Yes' })
        : t('properties.detail.no', { defaultValue: 'No' }),
      testID: 'info-card-elevator',
    },
  ];

  return (
    <View style={styles.infoGrid} testID="property-detail-info-grid">
      {cards.map((card) => (
        <InfoCard key={card.testID} {...card} />
      ))}
    </View>
  );
}

// ─── Sub-Components: Checklist ───────────────────────────────────────────────

interface ChecklistSectionProps {
  items: string[];
}

/** Read-only list of checklist items */
function ChecklistSection({ items }: ChecklistSectionProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  return (
    <View style={styles.section} testID="property-detail-checklist">
      <Text style={styles.sectionTitle}>
        {t('properties.detail.checklist_title', { defaultValue: 'Checklist' })}
      </Text>
      {items.map((item, index) => (
        <View key={`checklist-${index}`} style={styles.checklistItem}>
          <Text style={styles.checklistBullet}>•</Text>
          <Text style={styles.checklistText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Sub-Components: Requirements ────────────────────────────────────────────

interface RequirementsSectionProps {
  requirements: string[];
}

/** Read-only requirement chips display */
function RequirementsSection({ requirements }: RequirementsSectionProps) {
  const { t } = useTranslation();

  if (requirements.length === 0) return null;

  /** Get translated label for predefined requirements or use raw value */
  const getLabel = (value: string): string => {
    const predefined = PREDEFINED_REQUIREMENTS.find((r) => r.value === value);
    return predefined ? t(predefined.labelKey, { defaultValue: value }) : value;
  };

  return (
    <View style={styles.section} testID="property-detail-requirements">
      <Text style={styles.sectionTitle}>
        {t('properties.detail.requirements_title', { defaultValue: 'Special Requirements' })}
      </Text>
      <View style={styles.chipsRow}>
        {requirements.map((req) => (
          <View key={req} style={styles.chip} testID={`requirement-chip-${req}`}>
            <Text style={styles.chipText}>{getLabel(req)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Sub-Components: Access Instructions ─────────────────────────────────────

interface AccessInstructionsSectionProps {
  instructions: string | null;
}

/** Private card showing access instructions */
function AccessInstructionsSection({ instructions }: AccessInstructionsSectionProps) {
  const { t } = useTranslation();

  if (!instructions) return null;

  return (
    <View style={styles.accessCard} testID="property-detail-access">
      <View style={styles.accessHeader}>
        <Text style={styles.accessIcon}>🔑</Text>
        <Text style={styles.sectionTitle}>
          {t('properties.detail.access_title', { defaultValue: 'Access Instructions' })}
        </Text>
      </View>
      <Text style={styles.accessPrivateLabel}>
        {t('properties.detail.access_private', { defaultValue: 'Private — visible only to you' })}
      </Text>
      <Text style={styles.accessText}>{instructions}</Text>
    </View>
  );
}

// ─── Sub-Components: Action Buttons ──────────────────────────────────────────

interface ActionButtonsProps {
  onEdit: () => void;
  onPublish: () => void;
}

/** Edit and Publish Offer action buttons */
function ActionButtons({ onEdit, onPublish }: ActionButtonsProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.actionsRow} testID="property-detail-actions">
      <Pressable
        style={styles.editButton}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('properties.detail.edit', { defaultValue: 'Edit property' })}
        testID="property-detail-edit-button"
      >
        <Text style={styles.editButtonText}>
          {t('properties.detail.edit', { defaultValue: 'Edit property' })}
        </Text>
      </Pressable>

      <Pressable
        style={styles.publishButton}
        onPress={onPublish}
        accessibilityRole="button"
        accessibilityLabel={t('properties.detail.publish_offer', { defaultValue: 'Publish Offer' })}
        testID="property-detail-publish-button"
      >
        <Text style={styles.publishButtonText}>
          {t('properties.detail.publish_offer', { defaultValue: 'Publish Offer' })}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Full property detail screen showing gallery, map, info, checklist,
 * requirements, access instructions, and action buttons.
 *
 * @param propertyId - Property ID to fetch and display
 */
export const PropertyDetailScreen: React.FC<PropertyDetailScreenProps> = ({ propertyId }) => {
  const { t } = useTranslation();
  const {
    selectedProperty,
    isDetailLoading,
    error,
    fetchDetail,
    clearError,
  } = useProperties();

  const [fullScreenVisible, setFullScreenVisible] = useState(false);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);

  useEffect(() => {
    void fetchDetail(propertyId);
  }, [fetchDetail, propertyId]);

  const handleRetry = useCallback(() => {
    clearError();
    void fetchDetail(propertyId);
  }, [clearError, fetchDetail, propertyId]);

  const handlePhotoPress = useCallback((index: number) => {
    setFullScreenIndex(index);
    setFullScreenVisible(true);
  }, []);

  const handleCloseFullScreen = useCallback(() => {
    setFullScreenVisible(false);
  }, []);

  const handleEdit = useCallback(() => {
    Alert.alert(
      t('properties.detail.edit', { defaultValue: 'Edit property' }),
      t('properties.detail.edit_placeholder', {
        defaultValue: 'Navigation to EditPropertyScreen will be connected here.',
      }),
    );
  }, [t]);

  const handlePublishOffer = useCallback(() => {
    Alert.alert(
      t('properties.detail.publish_offer', { defaultValue: 'Publish Offer' }),
      t('properties.detail.publish_placeholder', {
        defaultValue: 'Navigation to offer creation will be connected here.',
      }),
    );
  }, [t]);

  // ─── Render States ───────────────────────────────────────────────────────

  if (isDetailLoading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={handleRetry} />;
  }

  if (!selectedProperty) {
    return <ErrorState message={null} onRetry={handleRetry} />;
  }

  const property = selectedProperty;

  return (
    <View style={styles.container} testID="property-detail-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Photo Gallery */}
        <PhotoGallery photos={property.photos} onPhotoPress={handlePhotoPress} />

        {/* Header: Name + Offer Readiness */}
        <View style={styles.header}>
          <Text style={styles.propertyName} testID="property-detail-name">
            {property.name}
          </Text>
          <OfferReadinessIndicator isReady={property.isOfferReady} />
        </View>

        {/* Address */}
        <Text style={styles.address} testID="property-detail-address">
          {property.formattedAddress ?? `${property.address.street}, ${property.address.city}`}
        </Text>

        {/* Description */}
        {property.description && (
          <Text style={styles.description} testID="property-detail-description">
            {property.description}
          </Text>
        )}

        {/* Info Cards */}
        <InfoCardsGrid property={property} />

        {/* Map Section */}
        <View style={styles.section} testID="property-detail-map-section">
          <Text style={styles.sectionTitle}>
            {t('properties.detail.location_title', { defaultValue: 'Location' })}
          </Text>
          <PropertyMap coordinates={property.location} editable={false} />
        </View>

        {/* Checklist */}
        <ChecklistSection items={property.checklistItems} />

        {/* Requirements */}
        <RequirementsSection requirements={property.specialRequirements} />

        {/* Access Instructions */}
        <AccessInstructionsSection instructions={property.accessInstructions} />

        {/* Action Buttons */}
        <ActionButtons onEdit={handleEdit} onPublish={handlePublishOffer} />
      </ScrollView>

      {/* Full-screen photo modal */}
      {property.photos.length > 0 && (
        <FullScreenGallery
          visible={fullScreenVisible}
          photos={property.photos}
          initialIndex={fullScreenIndex}
          onClose={handleCloseFullScreen}
        />
      )}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },

  // ─── Error ────────────────────────────────────────────────────────────────
  errorIcon: {
    fontSize: FONT_SIZE.icon,
    marginBottom: SPACING.md,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.body,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  retryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  retryButtonText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
  },

  // ─── Gallery ──────────────────────────────────────────────────────────────
  galleryScroll: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  galleryPhoto: {
    width: GALLERY_PHOTO_WIDTH,
    height: GALLERY_PHOTO_HEIGHT,
    borderRadius: CARD_BORDER_RADIUS,
  },
  galleryEmpty: {
    height: GALLERY_PHOTO_HEIGHT,
    backgroundColor: COLORS.card,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: CARD_BORDER_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryEmptyIcon: {
    fontSize: FONT_SIZE.icon,
    marginBottom: SPACING.sm,
  },
  galleryEmptyText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
  },

  // ─── Full Screen Modal ────────────────────────────────────────────────────
  fullScreenContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
  },
  fullScreenClose: {
    position: 'absolute',
    top: SPACING.xxl,
    right: SPACING.md,
    zIndex: 10,
    width: FULLSCREEN_CLOSE_SIZE,
    height: FULLSCREEN_CLOSE_SIZE,
    borderRadius: FULLSCREEN_CLOSE_SIZE / 2,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenCloseIcon: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
  },
  photoCounter: {
    position: 'absolute',
    top: SPACING.xxl,
    left: SPACING.md,
    zIndex: 10,
    backgroundColor: COLORS.card,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  photoCounterText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
  },
  fullScreenPhoto: {
    width: SCREEN_WIDTH,
    height: '100%',
  },

  // ─── Header ───────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
  },
  propertyName: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    marginRight: SPACING.sm,
  },
  address: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
  },
  description: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    lineHeight: DESCRIPTION_LINE_HEIGHT,
  },

  // ─── Offer Readiness Badge ────────────────────────────────────────────────
  offerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  offerBadgeReady: {
    backgroundColor: COLORS.accentMuted,
  },
  offerBadgeWarning: {
    backgroundColor: 'rgba(255, 217, 61, 0.1)',
  },
  offerDot: {
    width: OFFER_DOT_SIZE,
    height: OFFER_DOT_SIZE,
    borderRadius: OFFER_DOT_SIZE / 2,
    marginRight: SPACING.xs,
  },
  offerDotReady: {
    backgroundColor: COLORS.success,
  },
  offerDotWarning: {
    backgroundColor: COLORS.warning,
  },
  offerBadgeText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
  },
  offerTextReady: {
    color: COLORS.success,
  },
  offerTextWarning: {
    color: COLORS.warning,
  },

  // ─── Info Cards Grid ──────────────────────────────────────────────────────
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    gap: SPACING.sm,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    width: (SCREEN_WIDTH - SPACING.md * 2 - SPACING.sm * (INFO_CARD_COLUMNS - 1)) / INFO_CARD_COLUMNS,
    alignItems: 'center',
  },
  infoIcon: {
    fontSize: FONT_SIZE.title,
    marginBottom: SPACING.xs,
  },
  infoLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  infoValue: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    textAlign: 'center',
  },

  // ─── Sections ─────────────────────────────────────────────────────────────
  section: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },

  // ─── Checklist ────────────────────────────────────────────────────────────
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.xs,
  },
  checklistBullet: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.body,
    marginRight: SPACING.sm,
    lineHeight: DESCRIPTION_LINE_HEIGHT,
  },
  checklistText: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    lineHeight: DESCRIPTION_LINE_HEIGHT,
  },

  // ─── Requirements Chips ───────────────────────────────────────────────────
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    backgroundColor: COLORS.accentSubtle,
    borderRadius: CHIP_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  chipText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '500',
  },

  // ─── Access Instructions ──────────────────────────────────────────────────
  accessCard: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.lg,
  },
  accessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  accessIcon: {
    fontSize: FONT_SIZE.body,
    marginRight: SPACING.sm,
  },
  accessPrivateLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
    fontStyle: 'italic',
    marginBottom: SPACING.sm,
  },
  accessText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    lineHeight: ACCESS_TEXT_LINE_HEIGHT,
  },

  // ─── Action Buttons ───────────────────────────────────────────────────────
  actionsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
  },
  editButton: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  editButtonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
  },
  publishButton: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: SPACING.sm,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  publishButtonText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
  },
});

export default PropertyDetailScreen;

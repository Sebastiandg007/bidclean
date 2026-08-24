/**
 * PropertyCard
 *
 * List item card displaying property summary in PropertyListScreen FlatList.
 * Shows cover photo (signed URL with placeholder fallback), property name,
 * type badge, city + country, bedroom/bathroom counts, and offer-ready indicator.
 */

import React, { useCallback } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, FONT_SIZE, PROPERTY_TYPES, SPACING } from '../properties.constants';
import type { PropertyListItem } from '../properties.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyCardProps {
  property: PropertyListItem;
  onPress?: (propertyId: string) => void;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const COVER_PHOTO_HEIGHT = 140;
const BADGE_BORDER_RADIUS = 12;
const OFFER_DOT_SIZE = 8;

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface CoverPhotoProps {
  url: string | null;
  propertyName: string;
}

/** Cover photo with signed URL or placeholder fallback */
function CoverPhoto({ url, propertyName }: CoverPhotoProps) {
  const { t } = useTranslation();

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.coverPhoto}
        resizeMode="cover"
        accessibilityLabel={t('properties.card.photo_a11y', {
          defaultValue: 'Photo of {{name}}',
          name: propertyName,
        })}
      />
    );
  }

  return (
    <View style={styles.coverPlaceholder}>
      <Text style={styles.placeholderIcon}>🏠</Text>
      <Text style={styles.placeholderText}>
        {t('properties.card.no_photo', { defaultValue: 'No photo' })}
      </Text>
    </View>
  );
}

interface TypeBadgeProps {
  type: PropertyListItem['type'];
}

/** Colored chip showing the property type */
function TypeBadge({ type }: TypeBadgeProps) {
  const { t } = useTranslation();

  const typeConfig = PROPERTY_TYPES.find((pt) => pt.value === type);
  const label = typeConfig
    ? t(typeConfig.labelKey, { defaultValue: type })
    : type;

  return (
    <View style={styles.typeBadge}>
      <Text style={styles.typeBadgeText}>{label}</Text>
    </View>
  );
}

interface RoomCountsProps {
  bedrooms: number;
  bathrooms: number;
}

/** Row with bedroom and bathroom icons + counts */
function RoomCounts({ bedrooms, bathrooms }: RoomCountsProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.roomRow}>
      <Text
        style={styles.roomText}
        accessibilityLabel={t('properties.card.bedrooms_a11y', {
          defaultValue: '{{count}} bedrooms',
          count: bedrooms,
        })}
      >
        🛏️ {bedrooms}
      </Text>
      <Text
        style={styles.roomText}
        accessibilityLabel={t('properties.card.bathrooms_a11y', {
          defaultValue: '{{count}} bathrooms',
          count: bathrooms,
        })}
      >
        🚿 {bathrooms}
      </Text>
    </View>
  );
}

interface OfferReadyBadgeProps {
  isReady: boolean;
}

/** Green dot + "Ready" text when property is offer-ready */
function OfferReadyBadge({ isReady }: OfferReadyBadgeProps) {
  const { t } = useTranslation();

  if (!isReady) return null;

  return (
    <View
      style={styles.offerReadyBadge}
      accessibilityLabel={t('properties.card.offer_ready_a11y', {
        defaultValue: 'Ready for offers',
      })}
    >
      <View style={styles.offerReadyDot} />
      <Text style={styles.offerReadyText}>
        {t('properties.card.offer_ready', { defaultValue: 'Ready' })}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const PropertyCard: React.FC<PropertyCardProps> = ({ property, onPress }) => {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    onPress?.(property.id);
  }, [onPress, property.id]);

  const locationText = `${property.city}, ${property.country}`;

  return (
    <Pressable
      style={styles.container}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('properties.card.a11y_label', {
        defaultValue: '{{name}}, {{type}} in {{location}}',
        name: property.name,
        type: property.type,
        location: locationText,
      })}
      accessibilityHint={t('properties.card.a11y_hint', {
        defaultValue: 'Double tap to view property details',
      })}
      testID={`property-card-${property.id}`}
    >
      <CoverPhoto url={property.coverPhotoUrl} propertyName={property.name} />

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
            {property.name}
          </Text>
          <OfferReadyBadge isReady={property.isOfferReady} />
        </View>

        <View style={styles.metaRow}>
          <TypeBadge type={property.type} />
          <Text style={styles.location} numberOfLines={1}>
            {locationText}
          </Text>
        </View>

        <RoomCounts bedrooms={property.bedrooms} bathrooms={property.bathrooms} />
      </View>
    </Pressable>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm + SPACING.xs,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  coverPhoto: {
    width: '100%',
    height: COVER_PHOTO_HEIGHT,
  },
  coverPlaceholder: {
    width: '100%',
    height: COVER_PHOTO_HEIGHT,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 32,
    marginBottom: SPACING.xs,
  },
  placeholderText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
  },
  content: {
    padding: SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
  },
  name: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    marginRight: SPACING.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  typeBadge: {
    backgroundColor: 'rgba(0, 245, 212, 0.12)',
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs - 1,
    marginRight: SPACING.sm,
  },
  typeBadgeText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  location: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  roomText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
  },
  offerReadyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 245, 212, 0.1)',
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs - 1,
  },
  offerReadyDot: {
    width: OFFER_DOT_SIZE,
    height: OFFER_DOT_SIZE,
    borderRadius: OFFER_DOT_SIZE / 2,
    backgroundColor: COLORS.success,
    marginRight: SPACING.xs,
  },
  offerReadyText: {
    color: COLORS.success,
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
  },
});

export default PropertyCard;

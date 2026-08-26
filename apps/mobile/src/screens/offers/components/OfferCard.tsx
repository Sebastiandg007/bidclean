/**
 * OfferCard — List item component displaying an offer summary.
 *
 * Shows property cover photo + name, service type badge, offered price + total cost,
 * scheduled date/time, and a state badge with color coding per state.
 * Tapping the card navigates to the offer detail screen.
 */

import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Offer } from '../offers.types';
import {
  COLORS,
  FONT_SIZE,
  SERVICE_TYPES,
  SPACING,
  STATE_COLORS,
} from '../offers.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OfferCardProps {
  /** The offer to display */
  offer: Offer;
  /** Callback when the card is tapped — navigates to offer detail */
  onPress: (offerId: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_BORDER_RADIUS = 12;
const PHOTO_SIZE = 72;
const PHOTO_BORDER_RADIUS = 8;
const BADGE_BORDER_RADIUS = 6;
const CENTS_DIVISOR = 100;
const SHADOW_OPACITY = 0.25;
const SHADOW_RADIUS = 4;
const ELEVATION = 3;
const STATE_BADGE_OPACITY = 0.15;
const SHADOW_COLOR = '#000000';
const SEPARATOR_CHAR = '•';
const PLACEHOLDER_ICON = '🏠';
const ACTIVE_OPACITY = 0.7;
const STATE_BADGE_VERTICAL_PADDING = 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats cents to a currency string (e.g., 5500 → "$55.00").
 */
function formatCurrency(cents: number, currency: string): string {
  const amount = cents / CENTS_DIVISOR;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Formats an ISO date string to a locale-aware date/time representation.
 */
function formatScheduledDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Converts a 0-1 opacity value to a 2-char hex suffix (e.g., 0.15 → "26").
 */
function hexOpacity(opacity: number): string {
  const maxHex = 255;
  const hex = Math.round(opacity * maxHex)
    .toString(16)
    .padStart(2, '0');
  return hex;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferCard({ offer, onPress }: OfferCardProps): React.JSX.Element {
  const { t } = useTranslation();

  const serviceTypeConfig = useMemo(
    () => SERVICE_TYPES.find((st) => st.value === offer.serviceType),
    [offer.serviceType],
  );

  const serviceLabel = serviceTypeConfig
    ? t(serviceTypeConfig.labelKey)
    : offer.serviceType;

  const serviceIcon = serviceTypeConfig?.icon ?? PLACEHOLDER_ICON;

  const formattedPrice = useMemo(
    () => formatCurrency(offer.offeredPriceCents, offer.currency),
    [offer.offeredPriceCents, offer.currency],
  );

  const formattedTotal = useMemo(
    () => formatCurrency(offer.hostTotalCents, offer.currency),
    [offer.hostTotalCents, offer.currency],
  );

  const formattedDate = useMemo(
    () => formatScheduledDate(offer.scheduledAt),
    [offer.scheduledAt],
  );

  const stateColor = STATE_COLORS[offer.state];
  const stateLabel = t(`offers.state.${offer.state}`);
  const propertyName = offer.propertyNameSnapshot ?? t('offers.card.unknownProperty');

  const accessibilityLabel = t('offers.card.a11yLabel', {
    property: propertyName,
    service: serviceLabel,
    price: formattedPrice,
    state: stateLabel,
    date: formattedDate,
  });

  const handlePress = (): void => {
    onPress(offer.id);
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      activeOpacity={ACTIVE_OPACITY}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={`offer-card-${offer.id}`}
    >
      {/* Left: Property Cover Photo */}
      <View style={styles.photoContainer}>
        {offer.propertyCoverPhotoSnapshot ? (
          <Image
            source={{ uri: offer.propertyCoverPhotoSnapshot }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
            testID={`offer-card-photo-${offer.id}`}
          />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.photoPlaceholderIcon}>{PLACEHOLDER_ICON}</Text>
          </View>
        )}
      </View>

      {/* Right: Offer Details */}
      <View style={styles.content}>
        {/* Property Name */}
        <Text style={styles.propertyName} numberOfLines={1}>
          {propertyName}
        </Text>

        {/* Service Type Badge */}
        <View style={styles.serviceTypeBadge}>
          <Text style={styles.serviceTypeIcon}>{serviceIcon}</Text>
          <Text style={styles.serviceTypeLabel}>{serviceLabel}</Text>
        </View>

        {/* Price Display */}
        <View style={styles.priceRow}>
          <Text style={styles.priceOffered}>{formattedPrice}</Text>
          <Text style={styles.priceSeparator}>{SEPARATOR_CHAR}</Text>
          <Text style={styles.priceTotal}>
            {t('offers.card.total')} {formattedTotal}
          </Text>
        </View>

        {/* Scheduled Date + State Badge Row */}
        <View style={styles.bottomRow}>
          <Text style={styles.scheduledDate}>{formattedDate}</Text>

          <View
            style={[
              styles.stateBadge,
              { backgroundColor: stateColor + hexOpacity(STATE_BADGE_OPACITY) },
            ]}
          >
            <Text style={[styles.stateBadgeLabel, { color: stateColor }]}>
              {stateLabel}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: SHADOW_OPACITY,
    shadowRadius: SHADOW_RADIUS,
    elevation: ELEVATION,
  },
  photoContainer: {
    marginRight: SPACING.md,
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_BORDER_RADIUS,
  },
  photoPlaceholder: {
    backgroundColor: COLORS.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderIcon: {
    fontSize: FONT_SIZE.icon,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  propertyName: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  serviceTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accentMuted,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginTop: SPACING.xs,
  },
  serviceTypeIcon: {
    fontSize: FONT_SIZE.caption,
    marginRight: SPACING.xs,
  },
  serviceTypeLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  priceOffered: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '700',
    color: COLORS.accent,
  },
  priceSeparator: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    marginHorizontal: SPACING.xs,
  },
  priceTotal: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  scheduledDate: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  stateBadge: {
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: STATE_BADGE_VERTICAL_PADDING,
  },
  stateBadgeLabel: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});

export default OfferCard;

/**
 * OfferCard — Radar list item displaying an available offer summary.
 *
 * Shows property cover photo thumbnail, property name, property type,
 * service type badge, Cleaner payout price (formatted by locale),
 * distance (km or miles), scheduled date/time (in offer timezone),
 * and urgency indicator for offers within 2 hours.
 *
 * Tapping the card navigates to the Offer Detail screen.
 */

import React, { useMemo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';

import type { RadarOffer } from '../../radar.types';
import { URGENCY_THRESHOLD_MS } from '../../radar.constants';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  body: 16,
  subtitle: 14,
  caption: 11,
  icon: 32,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_BORDER_RADIUS = 12;
const PHOTO_SIZE = 72;
const PHOTO_BORDER_RADIUS = 8;
const BADGE_BORDER_RADIUS = 6;
const CENTS_DIVISOR = 100;
const METERS_PER_KM = 1000;
const ACTIVE_OPACITY = 0.7;
const PLACEHOLDER_ICON = '🏠';
const URGENCY_DOT_SIZE = 8;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OfferCardProps {
  /** The radar offer to display */
  offer: RadarOffer;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats cents to a locale-aware currency string.
 */
function formatPayout(cents: number, currency: string): string {
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
 * Formats distance in meters to a readable km/mi string.
 * Uses km as the default unit (configurable per locale in the future).
 */
function formatDistance(meters: number): string {
  const km = meters / METERS_PER_KM;
  if (km < 1) {
    return `${Math.round(meters)} m`;
  }
  return `${km.toFixed(1)} km`;
}

/**
 * Formats an ISO date string to a locale-aware date/time in the offer's timezone.
 */
function formatScheduledDateTime(isoString: string, timezone: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Determines whether an offer is urgent (scheduled within 2 hours).
 */
function isOfferUrgent(scheduledAt: string): boolean {
  const scheduledTime = new Date(scheduledAt).getTime();
  const now = Date.now();
  return scheduledTime - now <= URGENCY_THRESHOLD_MS && scheduledTime > now;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferCard({ offer }: OfferCardProps): React.JSX.Element {
  const { t } = useTranslation('radar');
  const navigation = useNavigation<{ navigate: (route: string, params: { offerId: string }) => void }>();

  const isUrgent = useMemo(
    () => isOfferUrgent(offer.scheduledAt),
    [offer.scheduledAt],
  );

  const formattedPayout = useMemo(
    () => formatPayout(offer.priceBreakdown.payoutCents, offer.priceBreakdown.currency),
    [offer.priceBreakdown.payoutCents, offer.priceBreakdown.currency],
  );

  const formattedDistance = useMemo(
    () => formatDistance(offer.distanceMeters),
    [offer.distanceMeters],
  );

  const formattedDate = useMemo(
    () => formatScheduledDateTime(offer.scheduledAt, offer.timezone),
    [offer.scheduledAt, offer.timezone],
  );

  const serviceLabel = t(`offerCard.serviceType.${offer.serviceType}`);

  const accessibilityLabel = t('offerCard.a11yLabel', {
    price: formattedPayout,
    service: serviceLabel,
    distance: formattedDistance,
  });

  const handlePress = (): void => {
    navigation.navigate('OfferDetail', { offerId: offer.offerId });
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      activeOpacity={ACTIVE_OPACITY}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={`radar-offer-card-${offer.offerId}`}
    >
      {/* Left: Property Cover Photo */}
      <View style={styles.photoContainer}>
        {offer.propertySnapshot.coverPhotoUrl ? (
          <Image
            source={{ uri: offer.propertySnapshot.coverPhotoUrl }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
            testID={`radar-offer-photo-${offer.offerId}`}
          />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.photoPlaceholderIcon}>{PLACEHOLDER_ICON}</Text>
          </View>
        )}
      </View>

      {/* Right: Offer Details */}
      <View style={styles.content}>
        {/* Top row: Property name + urgency dot */}
        <View style={styles.topRow}>
          <Text style={styles.propertyName} numberOfLines={1}>
            {offer.propertySnapshot.name}
          </Text>
          {isUrgent && (
            <View
              style={styles.urgencyDot}
              accessibilityLabel={t('offerCard.urgentLabel')}
            />
          )}
        </View>

        {/* Property type */}
        <Text style={styles.propertyType} numberOfLines={1}>
          {offer.propertySnapshot.type} • {offer.propertySnapshot.city}
        </Text>

        {/* Service Type Badge */}
        <View style={styles.serviceTypeBadge}>
          <Text style={styles.serviceTypeLabel}>{serviceLabel}</Text>
        </View>

        {/* Bottom row: Price, Distance, Date */}
        <View style={styles.bottomRow}>
          <Text style={styles.payoutPrice}>{formattedPayout}</Text>
          <Text style={styles.separator}>•</Text>
          <Text style={styles.distance}>{formattedDistance}</Text>
          <Text style={styles.separator}>•</Text>
          <Text style={styles.scheduledDate}>{formattedDate}</Text>
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
    backgroundColor: COLORS.accentSubtle,
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  propertyName: {
    flex: 1,
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  urgencyDot: {
    width: URGENCY_DOT_SIZE,
    height: URGENCY_DOT_SIZE,
    borderRadius: URGENCY_DOT_SIZE / 2,
    backgroundColor: COLORS.accent,
    marginLeft: SPACING.sm,
  },
  propertyType: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  serviceTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accentSubtle,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginTop: SPACING.xs,
  },
  serviceTypeLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.accent,
    fontWeight: '500',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  payoutPrice: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '700',
    color: COLORS.accent,
  },
  separator: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    marginHorizontal: SPACING.xs,
  },
  distance: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  scheduledDate: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
});

export default OfferCard;

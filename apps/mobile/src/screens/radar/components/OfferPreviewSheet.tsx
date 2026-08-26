/**
 * OfferPreviewSheet — Bottom sheet preview triggered by pin tap.
 *
 * Displays a summary of the selected offer:
 * - Property name, type, city, cover photo
 * - Service type badge
 * - Scheduled date/time and estimated duration
 * - Cleaner payout price and distance
 * - "View Full Details" navigation button
 * - "Quick Accept" button (disabled when offline)
 *
 * Swipe down to dismiss (calls store.selectOffer(null)).
 * Marks offer as viewed on open.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';

import type { RadarOffer } from '../radar.types';
import { URGENCY_THRESHOLD_MS } from '../radar.constants';
import { useRadarStore } from '../useRadarStore';

// ─── Service Type i18n Key Mapping ───────────────────────────────────────────

/** Maps service type identifiers to scoped i18n keys (relative to 'radar' namespace) */
const SERVICE_TYPE_I18N_KEYS: Record<string, string> = {
  standard: 'filter.serviceType.standard',
  deep: 'filter.serviceType.deep',
  move_in_out: 'filter.serviceType.moveInOut',
  post_construction: 'filter.serviceType.postConstruction',
  post_event: 'filter.serviceType.postEvent',
  recurring: 'filter.serviceType.recurring',
};

function getServiceTypeI18nKey(serviceType: string): string {
  return SERVICE_TYPE_I18N_KEYS[serviceType] ?? 'filter.serviceType.standard';
}

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#1F2833',
  overlay: 'rgba(0, 0, 0, 0.5)',
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  accentDisabled: 'rgba(0, 245, 212, 0.3)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  textDisabled: 'rgba(255, 255, 255, 0.3)',
  handle: 'rgba(255, 255, 255, 0.3)',
  buttonOutline: 'rgba(255, 255, 255, 0.2)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  title: 18,
  body: 14,
  caption: 12,
  button: 16,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_BORDER_RADIUS = 20;
const HANDLE_WIDTH = 40;
const HANDLE_HEIGHT = 4;
const PHOTO_SIZE = 64;
const PHOTO_BORDER_RADIUS = 8;
const BADGE_BORDER_RADIUS = 6;
const BUTTON_BORDER_RADIUS = 12;
const BUTTON_HEIGHT = 48;
const DISMISS_THRESHOLD = 100;
const ANIMATION_DURATION = 300;
const CENTS_DIVISOR = 100;
const METERS_PER_KM = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function formatDistance(meters: number): string {
  const km = meters / METERS_PER_KM;
  if (km < 1) {
    return `${Math.round(meters)} m`;
  }
  return `${km.toFixed(1)} km`;
}

function formatScheduledDateTime(isoString: string, timezone: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
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

function isOfferUrgent(scheduledAt: string): boolean {
  const scheduledTime = new Date(scheduledAt).getTime();
  const now = Date.now();
  return scheduledTime - now <= URGENCY_THRESHOLD_MS && scheduledTime > now;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferPreviewSheet(): React.JSX.Element | null {
  const { t } = useTranslation('radar');
  const navigation = useNavigation<{ navigate: (route: string, params: { offerId: string }) => void }>();

  const selectedOfferId = useRadarStore((state) => state.selectedOfferId);
  const offers = useRadarStore((state) => state.offers);
  const connectionStatus = useRadarStore((state) => state.connectionStatus);
  const selectOffer = useRadarStore((state) => state.selectOffer);
  const markOfferViewed = useRadarStore((state) => state.markOfferViewed);

  const selectedOffer: RadarOffer | undefined = selectedOfferId
    ? offers.get(selectedOfferId)
    : undefined;

  const isOffline = connectionStatus === 'disconnected';

  // ─── Animation ───────────────────────────────────────────────────────────

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (selectedOffer) {
      // Mark as viewed
      markOfferViewed(selectedOffer.offerId);

      // Slide in
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Slide out
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [selectedOffer, translateY, overlayOpacity, markOfferViewed]);

  // ─── Swipe to Dismiss ────────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // ─── Handlers ────────────────────────────────────────────────────────────

  const dismiss = useCallback((): void => {
    selectOffer(null);
  }, [selectOffer]);

  const handleViewDetails = useCallback((): void => {
    if (selectedOffer) {
      navigation.navigate('OfferDetail', { offerId: selectedOffer.offerId });
      selectOffer(null);
    }
  }, [selectedOffer, navigation, selectOffer]);

  const handleQuickAccept = useCallback((): void => {
    if (isOffline || !selectedOffer) return;
    // Delegates to offer-negotiation module (future implementation)
    // For now, navigate to offer detail where full accept flow lives
    navigation.navigate('OfferDetail', { offerId: selectedOffer.offerId });
    selectOffer(null);
  }, [isOffline, selectedOffer, navigation, selectOffer]);

  // ─── Computed Values ─────────────────────────────────────────────────────

  const formattedPayout = useMemo(
    () =>
      selectedOffer
        ? formatPayout(selectedOffer.priceBreakdown.payoutCents, selectedOffer.priceBreakdown.currency)
        : '',
    [selectedOffer],
  );

  const formattedDistance = useMemo(
    () => (selectedOffer ? formatDistance(selectedOffer.distanceMeters) : ''),
    [selectedOffer],
  );

  const formattedDate = useMemo(
    () =>
      selectedOffer
        ? formatScheduledDateTime(selectedOffer.scheduledAt, selectedOffer.timezone)
        : '',
    [selectedOffer],
  );

  const isUrgent = useMemo(
    () => (selectedOffer ? isOfferUrgent(selectedOffer.scheduledAt) : false),
    [selectedOffer],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!selectedOffer) return null;

  return (
    <View style={styles.wrapper} testID="offer-preview-sheet">
      {/* Overlay */}
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          onPress={dismiss}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel={t('preview.dismiss', { defaultValue: 'Dismiss' })}
        />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        {/* Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Header: Photo + Property Info */}
          <View style={styles.header}>
            {selectedOffer.propertySnapshot.coverPhotoUrl ? (
              <Image
                source={{ uri: selectedOffer.propertySnapshot.coverPhotoUrl }}
                style={styles.photo}
                accessibilityIgnoresInvertColors
                testID="preview-sheet-photo"
              />
            ) : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Text style={styles.photoPlaceholderIcon}>🏠</Text>
              </View>
            )}

            <View style={styles.headerInfo}>
              <Text style={styles.propertyName} numberOfLines={1}>
                {selectedOffer.propertySnapshot.name}
              </Text>
              <Text style={styles.propertyMeta} numberOfLines={1}>
                {selectedOffer.propertySnapshot.type} • {selectedOffer.propertySnapshot.city}
              </Text>

              {/* Service Type Badge */}
              <View style={styles.serviceTypeBadge}>
                <Text style={styles.serviceTypeLabel}>
                  {t(getServiceTypeI18nKey(selectedOffer.serviceType))}
                </Text>
              </View>
            </View>

            {/* Urgency indicator */}
            {isUrgent && <View style={styles.urgencyDot} />}
          </View>

          {/* Details Row */}
          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>
                {t('preview.scheduledAt', { date: formattedDate })}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>
                {t('preview.duration', { value: selectedOffer.estimatedDurationMinutes })}
              </Text>
            </View>
          </View>

          {/* Price + Distance */}
          <View style={styles.priceRow}>
            <Text style={styles.payoutPrice}>{formattedPayout}</Text>
            <Text style={styles.separator}>•</Text>
            <Text style={styles.distance}>
              {t('preview.distance', { value: formattedDistance })}
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.detailsButton}
              onPress={handleViewDetails}
              activeOpacity={0.7}
              accessibilityRole="button"
              testID="preview-view-details-button"
            >
              <Text style={styles.detailsButtonText}>
                {t('preview.viewDetails')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.acceptButton,
                isOffline && styles.acceptButtonDisabled,
              ]}
              onPress={handleQuickAccept}
              activeOpacity={isOffline ? 1 : 0.7}
              disabled={isOffline}
              accessibilityRole="button"
              accessibilityState={{ disabled: isOffline }}
              testID="preview-quick-accept-button"
            >
              <Text
                style={[
                  styles.acceptButtonText,
                  isOffline && styles.acceptButtonTextDisabled,
                ]}
              >
                {isOffline
                  ? t('preview.quickAcceptDisabled')
                  : t('preview.quickAccept')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  overlayTouchable: {
    flex: 1,
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: SHEET_BORDER_RADIUS,
    borderTopRightRadius: SHEET_BORDER_RADIUS,
    paddingBottom: SPACING.lg,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  handle: {
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: HANDLE_HEIGHT / 2,
    backgroundColor: COLORS.handle,
  },
  content: {
    paddingHorizontal: SPACING.lg,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_BORDER_RADIUS,
    marginRight: SPACING.md,
  },
  photoPlaceholder: {
    backgroundColor: COLORS.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderIcon: {
    fontSize: 28,
  },
  headerInfo: {
    flex: 1,
  },
  propertyName: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  propertyMeta: {
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
    marginTop: SPACING.sm,
  },
  serviceTypeLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.accent,
    fontWeight: '500',
  },
  urgencyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.accent,
    marginTop: SPACING.xs,
  },
  // Details
  detailsRow: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
  },
  detailItem: {
    marginRight: SPACING.lg,
  },
  detailLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  // Price
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  payoutPrice: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.accent,
  },
  separator: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    marginHorizontal: SPACING.sm,
  },
  distance: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  // Actions
  actionsRow: {
    gap: SPACING.sm,
  },
  detailsButton: {
    height: BUTTON_HEIGHT,
    borderRadius: BUTTON_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.buttonOutline,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  detailsButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  acceptButton: {
    height: BUTTON_HEIGHT,
    borderRadius: BUTTON_BORDER_RADIUS,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonDisabled: {
    backgroundColor: COLORS.accentDisabled,
  },
  acceptButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: '#0B0C10',
  },
  acceptButtonTextDisabled: {
    color: COLORS.textDisabled,
  },
});

export default OfferPreviewSheet;

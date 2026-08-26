/**
 * OfferDetailScreen — Shows full offer detail with property snapshot,
 * service details, price breakdown, state timeline, radius progress,
 * cancel action, and delivery count.
 *
 * Sections:
 * 1. Header with back button + state badge
 * 2. Property snapshot card (cover photo, name, city, type badge)
 * 3. Service details (type icon/label, scheduled date/time, duration)
 * 4. Price breakdown (Host view via PriceBreakdown component)
 * 5. State timeline (via StateTimeline component)
 * 6. Radius progress (only when state === ACTIVE)
 * 7. Cancel button (DRAFT/PUBLISHED/ACTIVE with confirmation dialog)
 * 8. Delivery count indicator
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useOffersStore } from './useOffers';
import { PriceBreakdown } from './components/PriceBreakdown';
import { StateTimeline } from './components/StateTimeline';
import { RadiusProgress } from './components/RadiusProgress';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  STATE_COLORS,
  SERVICE_TYPES,
} from './offers.constants';
import type { OfferDetailRouteParams, OfferState } from './offers.types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Layout tokens */
const COVER_PHOTO_HEIGHT = 180;
const BADGE_BORDER_RADIUS = 6;
const CARD_BORDER_RADIUS = 12;
const BACK_BUTTON_SIZE = 36;
const CANCEL_BUTTON_HEIGHT = 52;
const MINUTES_PER_HOUR = 60;
const LETTER_SPACING = 0.5;

/** States that allow the cancel action */
const CANCELLABLE_STATES: OfferState[] = ['DRAFT', 'PUBLISHED', 'ACTIVE'];

/** Radius expansion interval from env (milliseconds) */
const OFFER_EXPANSION_INTERVAL_MS = Number(
  process.env.EXPO_PUBLIC_OFFER_EXPANSION_INTERVAL_MS ?? '300000',
);

/** Max radius from env (meters) */
const OFFER_MAX_RADIUS_METERS = Number(
  process.env.EXPO_PUBLIC_OFFER_MAX_RADIUS ?? '25000',
);

// ─── Props ───────────────────────────────────────────────────────────────────

interface OfferDetailScreenProps {
  route: { params: OfferDetailRouteParams };
  navigation: {
    goBack: () => void;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatScheduledDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoDate;
  }
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainingMinutes = minutes % MINUTES_PER_HOUR;

  if (hours === 0) {
    return `${remainingMinutes}min`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}min`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferDetailScreen({
  route,
  navigation,
}: OfferDetailScreenProps): React.JSX.Element {
  const { offerId } = route.params;
  const { t } = useTranslation();

  const {
    selectedOffer,
    isLoading,
    isCancelling,
    fetchOfferDetail,
    cancelOffer,
  } = useOffersStore();

  // ─── Fetch offer detail on mount ──────────────────────────────────────────

  useEffect(() => {
    fetchOfferDetail(offerId);
  }, [offerId, fetchOfferDetail]);

  // ─── Derived State ────────────────────────────────────────────────────────

  const offer = selectedOffer;

  const canCancel = useMemo(() => {
    if (!offer) return false;
    return CANCELLABLE_STATES.includes(offer.state);
  }, [offer]);

  const showRadiusProgress = offer?.state === 'ACTIVE';

  const serviceTypeConfig = useMemo(() => {
    if (!offer) return null;
    return SERVICE_TYPES.find((s) => s.value === offer.serviceType) ?? null;
  }, [offer]);

  const deliveryCount = useMemo(() => {
    if (!offer?.stateTransitions) return null;
    const activatedTransition = offer.stateTransitions.find(
      (tr) => tr.toState === 'ACTIVE',
    );
    if (activatedTransition?.metadata) {
      const count = activatedTransition.metadata.deliveryCount;
      if (typeof count === 'number') return count;
    }
    return null;
  }, [offer]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      t('offers.detail.cancelConfirm.title'),
      t('offers.detail.cancelConfirm.message'),
      [
        {
          text: t('offers.detail.cancelConfirm.dismiss'),
          style: 'cancel',
        },
        {
          text: t('offers.detail.cancelConfirm.confirm'),
          style: 'destructive',
          onPress: () => {
            cancelOffer(offerId);
          },
        },
      ],
    );
  }, [t, cancelOffer, offerId]);

  // ─── Loading State ────────────────────────────────────────────────────────

  if (isLoading && !offer) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!offer) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyText}>
            {t('offers.detail.notFound')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleGoBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('offers.detail.back')}
          testID="back-button"
        >
          <Text style={styles.backIcon}>←</Text>
        </Pressable>

        <View
          style={[
            styles.stateBadge,
            { backgroundColor: STATE_COLORS[offer.state] },
          ]}
        >
          <Text style={styles.stateBadgeText}>
            {t(`offers.state.${offer.state}`)}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="offer-detail-scroll"
      >
        {/* Property Snapshot Card */}
        <View style={styles.card} testID="property-snapshot-card">
          {offer.propertyCoverPhotoSnapshot && (
            <Image
              source={{ uri: offer.propertyCoverPhotoSnapshot }}
              style={styles.coverPhoto}
              resizeMode="cover"
              accessibilityLabel={t('offers.detail.propertyCoverA11y')}
              testID="property-cover-photo"
            />
          )}

          <View style={styles.propertyInfo}>
            <Text style={styles.propertyName} numberOfLines={1}>
              {offer.propertyNameSnapshot ?? t('offers.detail.unknownProperty')}
            </Text>

            <Text style={styles.propertyCity} numberOfLines={1}>
              {offer.propertyCitySnapshot ?? ''}
            </Text>

            {offer.propertyTypeSnapshot && (
              <View style={styles.propertyTypeBadge}>
                <Text style={styles.propertyTypeBadgeText}>
                  {offer.propertyTypeSnapshot}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Service Details Section */}
        <View style={styles.card} testID="service-details-section">
          <Text style={styles.sectionTitle}>
            {t('offers.detail.serviceDetails')}
          </Text>

          {/* Service type */}
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>
              {serviceTypeConfig?.icon ?? '🧹'}
            </Text>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>
                {t('offers.detail.serviceType')}
              </Text>
              <Text style={styles.detailValue}>
                {serviceTypeConfig
                  ? t(serviceTypeConfig.labelKey)
                  : offer.serviceType}
              </Text>
            </View>
          </View>

          {/* Scheduled date/time */}
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>📅</Text>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>
                {t('offers.detail.scheduledAt')}
              </Text>
              <Text style={styles.detailValue}>
                {formatScheduledDate(offer.scheduledAt)}
              </Text>
            </View>
          </View>

          {/* Duration */}
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>⏱️</Text>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>
                {t('offers.detail.duration')}
              </Text>
              <Text style={styles.detailValue}>
                {formatDuration(offer.estimatedDurationMinutes)}
              </Text>
            </View>
          </View>
        </View>

        {/* Price Breakdown (Host view) */}
        <PriceBreakdown
          offeredPriceCents={offer.offeredPriceCents}
          currency={offer.currency}
          hostServiceFeeCents={offer.hostServiceFeeCents}
          hostTotalCents={offer.hostTotalCents}
          hostServiceFeeRateBps={offer.hostServiceFeeRateBps}
        />

        {/* State Timeline */}
        <StateTimeline
          transitions={offer.stateTransitions ?? []}
          currentState={offer.state}
        />

        {/* Radius Progress (only when ACTIVE) */}
        {showRadiusProgress && (
          <RadiusProgress
            currentRadiusMeters={offer.currentRadiusMeters}
            maxRadiusMeters={OFFER_MAX_RADIUS_METERS}
            expansionIntervalMs={OFFER_EXPANSION_INTERVAL_MS}
            lastExpandedAt={offer.updatedAt}
            isActive
          />
        )}

        {/* Delivery Count Indicator */}
        {deliveryCount !== null && deliveryCount > 0 && (
          <View style={styles.deliveryCountCard} testID="delivery-count">
            <Text style={styles.deliveryCountIcon}>📤</Text>
            <Text style={styles.deliveryCountText}>
              {t('offers.detail.deliveryCount', { count: deliveryCount })}
            </Text>
          </View>
        )}

        {/* Cancel Button */}
        {canCancel && (
          <Pressable
            onPress={handleCancel}
            disabled={isCancelling}
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
              isCancelling && styles.cancelButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('offers.detail.cancelOffer')}
            accessibilityState={{ disabled: isCancelling }}
            testID="cancel-offer-button"
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={COLORS.error} />
            ) : (
              <Text style={styles.cancelButtonText}>
                {t('offers.detail.cancelOffer')}
              </Text>
            )}
          </Pressable>
        )}

        {/* Bottom spacing */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backButton: {
    width: BACK_BUTTON_SIZE,
    height: BACK_BUTTON_SIZE,
    borderRadius: BACK_BUTTON_SIZE / 2,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
  },
  stateBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BADGE_BORDER_RADIUS,
  },
  stateBadgeText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
    color: COLORS.background,
    textTransform: 'uppercase',
    letterSpacing: LETTER_SPACING,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    overflow: 'hidden',
  },
  coverPhoto: {
    width: '100%',
    height: COVER_PHOTO_HEIGHT,
  },
  propertyInfo: {
    padding: SPACING.md,
  },
  propertyName: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  propertyCity: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  propertyTypeBadge: {
    alignSelf: 'flex-start',
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BADGE_BORDER_RADIUS,
    backgroundColor: COLORS.accentSubtle,
  },
  propertyTypeBadgeText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    color: COLORS.accent,
    textTransform: 'capitalize',
  },
  sectionTitle: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: LETTER_SPACING,
    padding: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  detailIcon: {
    fontSize: FONT_SIZE.icon - 8,
    width: 32,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  deliveryCountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  deliveryCountIcon: {
    fontSize: FONT_SIZE.icon - 8,
  },
  deliveryCountText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  cancelButton: {
    height: CANCEL_BUTTON_HEIGHT,
    borderRadius: CARD_BORDER_RADIUS,
    backgroundColor: COLORS.errorSubtle,
    borderWidth: 1,
    borderColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  cancelButtonDisabled: {
    opacity: 0.5,
  },
  cancelButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.error,
  },
  bottomSpacer: {
    height: SPACING.xl,
  },
});

export default OfferDetailScreen;

/**
 * OfferConfirmationScreen — Full offer summary before publishing.
 *
 * Displays property card (name, cover photo, city from snapshot),
 * service type badge, scheduled date/time, duration, price breakdown
 * for the Host, and a FavoritesToggle component.
 *
 * Actions:
 * - "Publish Offer" CTA (accent color, calls publishOffer)
 * - "Save as Draft" secondary text (keeps DRAFT, navigates to list)
 * - Back button (navigates back to previous screen)
 *
 * Shows loading state while publishing and error handling with alert.
 */

import { useCallback, useEffect, useState } from 'react';
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

import type { OfferConfirmationRouteParams } from './offers.types';
import { useOffersStore } from './useOffers';
import { COLORS, FONT_SIZE, OFFER_ROUTES, SERVICE_TYPES, SPACING } from './offers.constants';
import { PriceBreakdown } from './components/PriceBreakdown';
import { FavoritesToggle } from './components/FavoritesToggle';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OfferConfirmationScreenProps {
  route: { params: OfferConfirmationRouteParams };
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COVER_PHOTO_HEIGHT = 160;
const BORDER_RADIUS = 12;
const BADGE_BORDER_RADIUS = 8;
const BUTTON_BORDER_RADIUS = 12;
const BACK_BUTTON_SIZE = 40;
const BACK_ICON_FONT_SIZE = 20;
const PUBLISH_BUTTON_MIN_HEIGHT = 52;
const MINUTES_PER_HOUR = 60;
const DESCRIPTION_LINE_HEIGHT = 22;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats a duration in minutes to a human-readable string (e.g., "2h 30min").
 */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainingMinutes = minutes % MINUTES_PER_HOUR;

  if (hours === 0) return `${remainingMinutes}min`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}min`;
}

/**
 * Formats a scheduled date/time string using locale formatting.
 */
function formatScheduledDateTime(isoString: string): { date: string; time: string } {
  const dateObj = new Date(isoString);

  const date = dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const time = dateObj.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return { date, time };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfferConfirmationScreen({
  route,
  navigation,
}: OfferConfirmationScreenProps) {
  const { t } = useTranslation('offers');
  const { offerId } = route.params;

  const {
    selectedOffer,
    isLoading,
    isPublishing,
    error,
    fetchOfferDetail,
    publishOffer,
  } = useOffersStore();

  const [favoritesFirst, setFavoritesFirst] = useState(false);

  // ─── Load Offer Detail ─────────────────────────────────────────────────

  useEffect(() => {
    fetchOfferDetail(offerId);
  }, [offerId, fetchOfferDetail]);

  // ─── Error Handling ────────────────────────────────────────────────────

  useEffect(() => {
    if (error) {
      Alert.alert(
        t('confirmation.error_title'),
        error,
        [{ text: t('confirmation.error_dismiss') }],
      );
    }
  }, [error, t]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    await publishOffer(offerId, favoritesFirst);

    const currentError = useOffersStore.getState().error;
    if (!currentError) {
      navigation.navigate(OFFER_ROUTES.OfferList);
    }
  }, [offerId, favoritesFirst, publishOffer, navigation]);

  const handleSaveAsDraft = useCallback(() => {
    navigation.navigate(OFFER_ROUTES.OfferList);
  }, [navigation]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // ─── Loading State ─────────────────────────────────────────────────────

  if (isLoading || !selectedOffer) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={COLORS.accent}
            testID="confirmation-loading"
          />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Derived Data ──────────────────────────────────────────────────────

  const serviceTypeConfig = SERVICE_TYPES.find(
    (st) => st.value === selectedOffer.serviceType,
  );
  const serviceTypeLabel = serviceTypeConfig
    ? t(serviceTypeConfig.labelKey.replace('offers.', ''))
    : selectedOffer.serviceType;
  const serviceTypeIcon = serviceTypeConfig?.icon ?? '🧹';

  const { date, time } = formatScheduledDateTime(selectedOffer.scheduledAt);
  const duration = formatDuration(selectedOffer.estimatedDurationMinutes);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} testID="offer-confirmation-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={handleGoBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('confirmation.back')}
            testID="confirmation-back-button"
            hitSlop={SPACING.sm}
          >
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {t('confirmation.title')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Property Card */}
        <View style={styles.propertyCard} testID="property-card">
          {selectedOffer.propertyCoverPhotoSnapshot && (
            <Image
              source={{ uri: selectedOffer.propertyCoverPhotoSnapshot }}
              style={styles.coverPhoto}
              accessibilityLabel={t('confirmation.property_photo_a11y', {
                name: selectedOffer.propertyNameSnapshot,
              })}
              testID="property-cover-photo"
            />
          )}
          <View style={styles.propertyInfo}>
            <Text style={styles.propertyName}>
              {selectedOffer.propertyNameSnapshot ?? t('confirmation.unknown_property')}
            </Text>
            {selectedOffer.propertyCitySnapshot && (
              <Text style={styles.propertyCity}>
                📍 {selectedOffer.propertyCitySnapshot}
              </Text>
            )}
          </View>
        </View>

        {/* Service Details */}
        <View style={styles.detailsCard} testID="service-details">
          <Text style={styles.sectionTitle}>
            {t('confirmation.service_details')}
          </Text>

          {/* Service Type Badge */}
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeIcon}>{serviceTypeIcon}</Text>
              <Text style={styles.badgeText}>{serviceTypeLabel}</Text>
            </View>
          </View>

          {/* Date & Time */}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {t('confirmation.scheduled_date')}
            </Text>
            <Text style={styles.detailValue}>{date}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {t('confirmation.scheduled_time')}
            </Text>
            <Text style={styles.detailValue}>{time}</Text>
          </View>

          {/* Duration */}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {t('confirmation.duration')}
            </Text>
            <Text style={styles.detailValue}>{duration}</Text>
          </View>
        </View>

        {/* Price Breakdown */}
        <PriceBreakdown
          offeredPriceCents={selectedOffer.offeredPriceCents}
          currency={selectedOffer.currency}
          hostServiceFeeCents={selectedOffer.hostServiceFeeCents}
          hostTotalCents={selectedOffer.hostTotalCents}
          hostServiceFeeRateBps={selectedOffer.hostServiceFeeRateBps}
        />

        {/* Favorites Toggle */}
        <FavoritesToggle
          enabled={favoritesFirst}
          onChange={setFavoritesFirst}
          hasFavorites={true}
        />

        {/* Description (if provided) */}
        {selectedOffer.description && (
          <View style={styles.descriptionCard}>
            <Text style={styles.sectionTitle}>
              {t('confirmation.description')}
            </Text>
            <Text style={styles.descriptionText}>
              {selectedOffer.description}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom Actions */}
      <View style={styles.actionsContainer}>
        <Pressable
          style={[styles.publishButton, isPublishing && styles.publishButtonDisabled]}
          onPress={handlePublish}
          disabled={isPublishing}
          accessibilityRole="button"
          accessibilityLabel={t('confirmation.publish_offer')}
          accessibilityState={{ disabled: isPublishing }}
          testID="publish-offer-button"
        >
          {isPublishing ? (
            <ActivityIndicator
              size="small"
              color={COLORS.background}
              testID="publish-loading"
            />
          ) : (
            <Text style={styles.publishButtonText}>
              {t('confirmation.publish_offer')}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.draftButton}
          onPress={handleSaveAsDraft}
          disabled={isPublishing}
          accessibilityRole="button"
          accessibilityLabel={t('confirmation.save_as_draft')}
          testID="save-as-draft-button"
        >
          <Text style={styles.draftButtonText}>
            {t('confirmation.save_as_draft')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  backButton: {
    width: BACK_BUTTON_SIZE,
    height: BACK_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BACK_BUTTON_SIZE / 2,
    backgroundColor: COLORS.card,
  },
  backIcon: {
    fontSize: BACK_ICON_FONT_SIZE,
    color: COLORS.textPrimary,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    flex: 1,
  },
  headerSpacer: {
    width: BACK_BUTTON_SIZE,
  },
  propertyCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS,
    overflow: 'hidden',
  },
  coverPhoto: {
    width: '100%',
    height: COVER_PHOTO_HEIGHT,
    backgroundColor: COLORS.accentMuted,
  },
  propertyInfo: {
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  propertyName: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  propertyCity: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
  },
  detailsCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accentSubtle,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    gap: SPACING.xs,
  },
  badgeIcon: {
    fontSize: FONT_SIZE.body,
  },
  badgeText: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '500',
    color: COLORS.accent,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  detailLabel: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  descriptionCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS,
    padding: SPACING.md,
  },
  descriptionText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    lineHeight: DESCRIPTION_LINE_HEIGHT,
  },
  actionsContainer: {
    padding: SPACING.md,
    gap: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  publishButton: {
    backgroundColor: COLORS.accent,
    borderRadius: BUTTON_BORDER_RADIUS,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: PUBLISH_BUTTON_MIN_HEIGHT,
  },
  publishButtonDisabled: {
    opacity: 0.6,
  },
  publishButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  draftButton: {
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  draftButtonText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
});

export default OfferConfirmationScreen;

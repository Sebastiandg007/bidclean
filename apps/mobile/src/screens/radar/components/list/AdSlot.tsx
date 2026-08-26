/**
 * AdSlot — Placeholder component for sponsored ad content in offer list view.
 *
 * Renders a styled container indicating an ad placement for free-tier Cleaners.
 * Actual ad SDK integration (RevenueCat Ads) will replace the placeholder content.
 * Visibility is controlled by the `useAdVisibility` hook via the entitlement layer.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  border: 'rgba(255, 255, 255, 0.1)',
  textMuted: 'rgba(255, 255, 255, 0.4)',
  textPlaceholder: 'rgba(255, 255, 255, 0.2)',
  placeholderBg: 'rgba(255, 255, 255, 0.04)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  caption: 11,
  body: 14,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_BORDER_RADIUS = 12;
const BORDER_WIDTH = 1;
const PLACEHOLDER_HEIGHT = 80;
const PLACEHOLDER_BORDER_RADIUS = 8;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders a placeholder ad slot in the offer list.
 *
 * Displays a "Sponsored" label at the top and a placeholder area
 * where the actual ad creative will be rendered once the ad SDK
 * is integrated. Matches the BidClean dark design system.
 */
export function AdSlot(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel={t('radar.adSlot.a11yLabel')}
      testID="ad-slot"
    >
      {/* Sponsored label */}
      <Text style={styles.sponsoredLabel}>
        {t('radar.adSlot.sponsored')}
      </Text>

      {/* Placeholder for ad creative */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          {t('radar.adSlot.placeholder')}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_BORDER_RADIUS,
    borderWidth: BORDER_WIDTH,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  sponsoredLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
  },
  placeholder: {
    height: PLACEHOLDER_HEIGHT,
    backgroundColor: COLORS.placeholderBg,
    borderRadius: PLACEHOLDER_BORDER_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPlaceholder,
  },
});

export default AdSlot;

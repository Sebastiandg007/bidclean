/**
 * AdSlot — Sponsored ad placement in the Cleaner radar offer list.
 *
 * Renders a real ad through the `AdProvider` seam (revenuecat-ads) inside the BidClean dark card
 * chrome. The layered render decision comes from `useAdSlot('radar-list')`: when `shouldRender` is
 * false (no eligibility / provider not ready / consent unresolved / placement not allowed) or the
 * provider yields no fill, the slot renders NOTHING and the list stays fully functional (Req 1.2 /
 * 1.5 / P1 / P7). The container, "Sponsored" label, accessibility label, and `testID="ad-slot"`
 * are preserved. Ads are Cleaner-only by placement key (Req 1.7 / P11). This component never calls
 * RevenueCat — impressions flow through the hook's `onPaidImpression` to the tracker (Req 2.6).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RADAR_AD_SLOT_KEY } from '../../../ads/ads.constants';
import { AdBanner } from '../../../ads/components/AdBanner';
import { useAdSlot } from '../../../ads/useAdSlot';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  border: 'rgba(255, 255, 255, 0.1)',
  textMuted: 'rgba(255, 255, 255, 0.4)',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  caption: 11,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_BORDER_RADIUS = 12;
const BORDER_WIDTH = 1;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders a real ad slot in the offer list, or nothing when the layered render decision or the
 * provider yields no ad. The surrounding chrome is localized; the ad creative is network-served.
 */
export function AdSlot(): React.JSX.Element | null {
  const { t } = useTranslation();
  const slot = useAdSlot(RADAR_AD_SLOT_KEY);

  if (!slot.shouldRender || slot.provider === null) {
    return null;
  }

  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel={t('radar.adSlot.a11yLabel')}
      testID="ad-slot"
    >
      <Text style={styles.sponsoredLabel}>{t('radar.adSlot.sponsored')}</Text>

      <AdBanner
        provider={slot.provider}
        format={slot.format}
        personalizationMode={slot.personalizationMode}
        onPaidImpression={slot.onPaidImpression}
      />
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
});

export default AdSlot;

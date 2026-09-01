/**
 * AdBanner — renders the provider ad view for a resolved slot, collapsing on no-fill/error.
 *
 * It renders `provider.renderAdView(...)` for the resolved provider/format/personalizationMode and
 * COLLAPSES (renders nothing) on `onNoFill`/`onError` (Req 1.5 / P7). It imports NO RevenueCat
 * (Req 2.6) — paid impressions flow out through the `onPaidImpression` callback supplied by
 * `useAdSlot`, which delegates to the tracker. Uses the BidClean dark design tokens.
 */

import React, { useCallback, useState } from 'react';
import { View } from 'react-native';

import type {
  AdFormat,
  AdProvider,
  PaidImpression,
  PersonalizationMode,
} from '../ads.types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AdBannerProps {
  readonly provider: AdProvider;
  readonly format: AdFormat;
  readonly personalizationMode: PersonalizationMode;
  readonly onPaidImpression: (impression: PaidImpression) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────────

/** Renders the network ad view, or nothing when the slot has no fill or errored. */
export function AdBanner({
  provider,
  format,
  personalizationMode,
  onPaidImpression,
}: AdBannerProps): React.JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false);

  const handleNoFill = useCallback(() => setCollapsed(true), []);
  const handleError = useCallback(() => setCollapsed(true), []);

  if (collapsed) {
    return null;
  }

  const adView = provider.renderAdView({
    format,
    personalizationMode,
    onPaidImpression,
    onNoFill: handleNoFill,
    onError: handleError,
  });

  if (adView === null) {
    return null;
  }

  return <View testID="ad-banner">{adView}</View>;
}

export default AdBanner;

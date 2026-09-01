/**
 * AdMobAdProvider — the concrete `AdProvider` backed by Google AdMob.
 *
 * Renders a banner via `react-native-google-mobile-ads`, forwards ONLY paid impressions (ILRD)
 * through the callback (Req 3.1), and OWNS the native ad object lifecycle — releasing native
 * resources when the React wrapper unmounts (Req 6.4 / design §7). It NEVER throws into the
 * render path: a no-fill or error collapses the slot via the provided callbacks (Req 1.5 / P7).
 * It never imports RevenueCat (Req 2.6) and never decides eligibility (Req 2.5).
 *
 * The AdMob SDK is a NATIVE module loaded defensively so this file type-checks and imports safely
 * even before a prebuild/EAS build (in CI the factory selects the mock, so this render path is
 * never exercised). All SDK access is guarded; a missing/failed SDK yields "no ad shown".
 */

import React from 'react';

import { RADAR_AD_FORMAT } from '../ads.constants';
import {
  PersonalizationMode,
  type AdProvider,
  type AdProviderContext,
  type AdViewProps,
  type PaidImpression,
} from '../ads.types';

// ─── Minimal typing of the AdMob SDK surface we consume ────────────────────────

interface AdMobPaidEvent {
  readonly value: number; // in the ad's currency major units
  readonly currency: string;
  readonly precision?: number;
}

interface AdMobBannerProps {
  readonly unitId: string;
  readonly onPaid?: (event: AdMobPaidEvent) => void;
  readonly onAdFailedToLoad?: (error: unknown) => void;
}

interface AdMobModule {
  default: { initialize(): Promise<unknown> };
  BannerAd: React.ComponentType<AdMobBannerProps>;
  BannerAdSize: Record<string, string>;
}

/** Load the native AdMob module defensively; returns null when unavailable (dev/CI). */
function loadAdMobModule(): AdMobModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as AdMobModule;
  } catch {
    return null;
  }
}

// ─── Impression mapping (pure) ─────────────────────────────────────────────────

const MICROS_PER_UNIT = 1_000_000;

/** Map an AdMob paid event to our metadata-only PaidImpression (Req 3.4 / P10). */
function toPaidImpression(
  event: AdMobPaidEvent,
  adUnitId: string,
): PaidImpression {
  return {
    eventId: `admob:${adUnitId}:${Date.now()}:${event.value}`,
    revenueMicros: Math.round(event.value * MICROS_PER_UNIT),
    currency: event.currency,
    network: 'admob',
    adUnitId,
    format: RADAR_AD_FORMAT,
    occurredAtMs: Date.now(),
  };
}

// ─── Provider ──────────────────────────────────────────────────────────────────

export class AdMobAdProvider implements AdProvider {
  readonly name = 'admob';
  private ready = false;

  constructor(private readonly bannerUnitId: string) {}

  async initialize(_context: AdProviderContext): Promise<void> {
    if (this.ready) {
      return; // Idempotent (Req 5.3).
    }
    const adMob = loadAdMobModule();
    if (adMob === null) {
      this.ready = false;
      return; // SDK unavailable → not ready; radar unaffected (Req 5.4).
    }
    try {
      await adMob.default.initialize();
      this.ready = true;
    } catch {
      this.ready = false; // Fail into "no ad shown"; the radar stays functional (Req 5.4).
    }
  }

  isReady(): boolean {
    return this.ready && this.bannerUnitId !== '';
  }

  renderAdView(props: AdViewProps): React.ReactElement | null {
    const adMob = loadAdMobModule();
    if (adMob === null || this.bannerUnitId === '') {
      props.onNoFill();
      return null;
    }
    return React.createElement(adMob.BannerAd, {
      unitId: this.bannerUnitId,
      onPaid: (event: AdMobPaidEvent) => {
        if (props.personalizationMode !== PersonalizationMode.UNRESOLVED) {
          props.onPaidImpression(toPaidImpression(event, this.bannerUnitId));
        }
      },
      onAdFailedToLoad: (error: unknown) => props.onError(error),
    });
  }
}

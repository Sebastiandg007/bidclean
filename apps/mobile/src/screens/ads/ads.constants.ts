/**
 * ads.constants — Configuration and identifiers for the display-ads module.
 *
 * ALL ad identifiers and keys come from `EXPO_PUBLIC_*` environment variables — never hardcoded
 * in logic (Req 7.1 / P8). Development falls back to AdMob's OFFICIAL public test unit ids so no
 * real ads serve in dev/CI (Req 7.4). A production build with missing config disables ads (the
 * factory NEVER falls back to the mock in production). Only public application/ad-unit ids are
 * used client-side; mediation account secrets are never shipped (Req 7.5).
 */

import type { AdEnvironment, AdFormat, AdPlatform } from './ads.types';

// ─── Provider selection ────────────────────────────────────────────────────────

/** Supported provider selectors (config-driven; defaults to AdMob). */
export const AdProviderName = { ADMOB: 'admob', MOCK: 'mock' } as const;
export type AdProviderName = (typeof AdProviderName)[keyof typeof AdProviderName];

/** Configured provider selector; defaults to AdMob when unset. */
export const ADS_PROVIDER: string =
  process.env.EXPO_PUBLIC_ADS_PROVIDER ?? AdProviderName.ADMOB;

/**
 * Operational UI feature flag / kill-switch. NOT a security control — it is client-side and
 * changeable by rebuilding. Eligibility is always governed by `ad_free` via `useAdVisibility`.
 * Defaults to enabled; the string `'false'` disables ads (radar unaffected).
 */
export const ADS_ENABLED: boolean = process.env.EXPO_PUBLIC_ADS_ENABLED !== 'false';

// ─── AdMob application ids (per platform, from env) ────────────────────────────

/** Per-platform AdMob application ids (empty when unconfigured). */
export const ADMOB_APP_IDS: Readonly<Record<AdPlatform, string>> = {
  ios: process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID ?? '',
  android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ?? '',
} as const;

// ─── AdMob banner ad unit ids (per platform, from env) ─────────────────────────

/** Per-platform configured banner ad unit ids (empty when unconfigured). */
export const ADMOB_BANNER_UNIT_IDS: Readonly<Record<AdPlatform, string>> = {
  ios: process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID ?? '',
  android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID ?? '',
} as const;

/**
 * AdMob OFFICIAL public test ad unit ids (documented by Google, not secrets). Used in development
 * so no real ads serve. These are the sanctioned sample banner ids per platform.
 */
export const ADMOB_TEST_BANNER_UNIT_IDS: Readonly<Record<AdPlatform, string>> = {
  ios: 'ca-app-pub-3940256099942544/2934735716',
  android: 'ca-app-pub-3940256099942544/6300978111',
} as const;

// ─── Slot / format defaults ─────────────────────────────────────────────────────

/** The single ad-slot key used by the Cleaner radar list (placement owned by offer-radar). */
export const RADAR_AD_SLOT_KEY = 'radar-list';

/** The ad format rendered in the radar list in the MVP. */
export const RADAR_AD_FORMAT: AdFormat = 'BANNER';

// ─── Resolution helpers (pure, config-driven) ─────────────────────────────────

/**
 * Resolve the banner ad unit id for a platform/environment. Development prefers the configured id
 * but falls back to the official TEST id so dev/CI never serve real ads. Production returns the
 * configured id (empty string when unconfigured → the factory disables ads).
 */
export function resolveBannerUnitId(
  platform: AdPlatform,
  environment: AdEnvironment,
): string {
  const configured = ADMOB_BANNER_UNIT_IDS[platform];
  if (environment === 'development') {
    return configured !== '' ? configured : ADMOB_TEST_BANNER_UNIT_IDS[platform];
  }
  return configured;
}

/** Whether AdMob is sufficiently configured to serve in production for the given platform. */
export function hasProductionAdMobConfig(platform: AdPlatform): boolean {
  return ADMOB_APP_IDS[platform] !== '' && ADMOB_BANNER_UNIT_IDS[platform] !== '';
}

// ─── i18n keys (AdSlot chrome; extends the existing radar.adSlot namespace) ─────

/** i18n keys for the AdSlot chrome (localized; the ad creative itself is network-served). */
export const ADS_I18N_KEYS = {
  SPONSORED: 'radar.adSlot.sponsored',
  A11Y_LABEL: 'radar.adSlot.a11yLabel',
  PLACEHOLDER: 'radar.adSlot.placeholder',
} as const;

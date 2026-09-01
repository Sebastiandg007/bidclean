/**
 * ads.types — Domain types for the display-ads module.
 *
 * The module renders ads through the abstract `AdProvider` seam (concrete: AdMob, Mock), gates
 * them behind the existing `ad_free` entitlement, and reports paid impressions to RevenueCat for
 * unified LTV. These types are pure (no SDK imports) so the core is testable without a native
 * build. See `.kiro/specs/revenuecat-ads/design.md` for the authority split and correctness
 * properties (P1–P14).
 */

import type React from 'react';

// ─── Ad format ───────────────────────────────────────────────────────────────

/** Which ad format a slot renders. */
export const AdFormat = { BANNER: 'BANNER', NATIVE: 'NATIVE' } as const;
export type AdFormat = (typeof AdFormat)[keyof typeof AdFormat];

// ─── Personalization (derived from consent; NEVER an eligibility flag) ─────────

/** Personalization derived from consent inputs; NOT an eligibility flag. */
export const PersonalizationMode = {
  PERSONALIZED: 'PERSONALIZED',
  NON_PERSONALIZED: 'NON_PERSONALIZED',
  UNRESOLVED: 'UNRESOLVED',
} as const;
export type PersonalizationMode =
  (typeof PersonalizationMode)[keyof typeof PersonalizationMode];

// ─── Consent inputs (two distinct signals, never collapsed) ────────────────────

/** iOS App Tracking Transparency status (subset we act on). */
export type TrackingAuthorizationStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'not_determined'
  | 'unavailable';

/** UMP / GDPR consent status (subset we act on). */
export type ConsentStatus = 'obtained' | 'not_required' | 'required' | 'unknown';

/** The two distinct consent inputs, tracked separately (never collapsed into a boolean). */
export interface ConsentState {
  readonly trackingAuthorizationStatus: TrackingAuthorizationStatus;
  readonly consentStatus: ConsentStatus;
}

// ─── Platform / environment ────────────────────────────────────────────────────

/** The mobile platforms the ad provider distinguishes. */
export type AdPlatform = 'ios' | 'android';

/** The build environment that drives provider selection and test-unit usage. */
export type AdEnvironment = 'development' | 'production';

// ─── Provider context & events ──────────────────────────────────────────────────

/**
 * Context passed to a provider on init. All identity/consent fields are optional so no provider
 * is forced to require identity (Req 2.1). `attributionId` is a privacy-scoped pseudonym, NEVER
 * the raw internal UUID (Req 5.1 / P9).
 */
export interface AdProviderContext {
  readonly platform: AdPlatform;
  readonly environment: AdEnvironment;
  readonly personalizationMode?: PersonalizationMode;
  /** Privacy-scoped attribution id (NOT the raw internal UUID). */
  readonly attributionId?: string;
}

/**
 * A paid, revenue-bearing impression reported by a provider (ILRD). Carries ad-event metadata
 * only — never PII (Req 3.4 / P10). The `eventId` keys duplicate reduction (Req 3.5 / P5 / P14).
 */
export interface PaidImpression {
  /** Client-generated unique id for dedup (one impression → at most one report). */
  readonly eventId: string;
  readonly revenueMicros: number;
  readonly currency: string;
  readonly network: string;
  readonly adUnitId: string;
  readonly format: AdFormat;
  readonly occurredAtMs: number;
}

/**
 * Props a concrete ad view receives (rendered by the provider through `AdBanner`). The provider
 * emits paid impressions and no-fill/error through these callbacks; `AdBanner` collapses on
 * no-fill/error (Req 1.5 / P7) and never imports RevenueCat (Req 2.6).
 */
export interface AdViewProps {
  readonly format: AdFormat;
  readonly personalizationMode: PersonalizationMode;
  readonly onPaidImpression: (impression: PaidImpression) => void;
  readonly onNoFill: () => void;
  readonly onError: (error: unknown) => void;
}

// ─── Provider seam ───────────────────────────────────────────────────────────

/**
 * The abstraction the radar renders through; concrete implementations are `AdMobAdProvider`
 * (real) and `MockAdProvider` (tests). The radar/`AdSlot` depend on this interface only, never
 * on AdMob APIs (Req 2.3 / P2). A provider NEVER grants or revokes eligibility (Req 2.5).
 */
export interface AdProvider {
  /** Stable provider name for diagnostics and selection assertions. */
  readonly name: string;
  /** Idempotent init; resilient to re-init (Req 5.3). */
  initialize(context: AdProviderContext): Promise<void>;
  /** Whether the provider is initialized and ready to serve. */
  isReady(): boolean;
  /** Returns the ad view for a slot, or null when unavailable (Req 1.5). */
  renderAdView(props: AdViewProps): React.ReactElement | null;
}

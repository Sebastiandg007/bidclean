# Implementation Plan: RevenueCat Ads

## Overview

`revenuecat-ads` monetizes the free tier with display advertising. It replaces the placeholder `AdSlot` in the Cleaner radar list with a real ad served by a mediation provider (Google AdMob in the MVP), reports each paid impression to RevenueCat for unified LTV, and gates everything behind the existing `ad_free` entitlement. It is **mobile-only, client-side, with no backend work** (no NestJS module, no DB, no migration, no endpoint) - `ad_free` already exists in `revenuecat-subscriptions`.

Implementation is bottom-up: pure/config core first (types, constants, personalization, attribution), then the tracker and provider seam (interface + mock + AdMob adapter + factory), then the ads store, then the slot lifecycle hook and `AdBanner`, then wiring the radar `AdSlot`, then i18n, then property-based and integration-style tests. Everything is testable in CI against `MockAdProvider` with the native SDK mocked - zero real AdMob/RevenueCat calls.

Coupling is one-directional and consumes existing seams: `revenuecat-ads` reads eligibility from `useAdVisibility` (`revenuecat-subscriptions`) and fills the `AdSlot` placement owned by `offer-radar`; it never re-decides eligibility, never changes placement, and never touches the backend.

## Tasks

- [x] 1. Types & configuration (pure core)
  - [x] 1.1 Create ads domain types
    - Create `apps/mobile/src/screens/ads/ads.types.ts`: `AdFormat` (BANNER|NATIVE), `PersonalizationMode` (PERSONALIZED|NON_PERSONALIZED|UNRESOLVED), `TrackingAuthorizationStatus`, `ConsentStatus`, `ConsentState`, `AdProviderContext` (platform, environment, optional personalizationMode + attributionId), `PaidImpression` (eventId, revenueMicros, currency, network, adUnitId, format, occurredAtMs), `AdViewProps`, `AdProvider` interface
    - _Requirements: 2.1, 3.1, 4.1_
  - [x] 1.2 Create ads constants (EXPO_PUBLIC_* config)
    - Create `apps/mobile/src/screens/ads/ads.constants.ts`: per-platform AdMob app ids + banner unit ids from `EXPO_PUBLIC_ADMOB_*`, AdMob official TEST unit ids for development, `EXPO_PUBLIC_ADS_PROVIDER` (default admob), `EXPO_PUBLIC_ADS_ENABLED` (operational flag, not security), i18n keys; no hardcoded ids
    - _Requirements: 6.1, 6.3, 6.5, 7.1, P8_
  - [x] 1.3 Add ad environment variables to `.env.example`
    - Add `EXPO_PUBLIC_ADMOB_IOS_APP_ID`, `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`, `EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID`, `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID`, `EXPO_PUBLIC_ADS_PROVIDER`, `EXPO_PUBLIC_ADS_ENABLED`; document `ADS_ENABLED` as an operational flag, not a security control
    - _Requirements: 6.1, 6.5_

- [x] 2. Personalization & attribution (pure)
  - [x] 2.1 Implement platform-aware personalization
    - Create `apps/mobile/src/screens/ads/personalization.ts`: `derivePersonalizationMode(platform, consent)` - iOS uses ATT + UMP; Android ignores ATT (`unavailable`) and decides from UMP; UNRESOLVED until known; else NON_PERSONALIZED; an `unavailable` ATT on Android is never a denial
    - _Requirements: 4.1, 4.2, 4.3, 4.4, P6_
  - [x] 2.2 Implement privacy-scoped attribution identity
    - Create `apps/mobile/src/screens/ads/ad-attribution.ts`: `deriveAdAttributionId(appUserId)` - a pseudonymous, purpose-separated id (e.g. HMAC over `appUserId + ':ads'`), NOT the raw UUID, NOT claimed as anonymization; never leaks internal ids
    - _Requirements: 5.1, 6.2, P9_
  - [x]* 2.3 Unit tests for personalization & attribution
    - personalization: full ATT x UMP matrix per platform (iOS vs Android), UNRESOLVED default, Android-unavailable-ATT not a denial; attribution: stable, non-raw, purpose-separated, no internal-id leakage
    - _Requirements: 4.3, 5.1, P6, P9_

- [x] 3. Ad revenue tracker
  - [x] 3.1 Implement AdRevenueTracker
    - Create `apps/mobile/src/screens/ads/ad-revenue-tracker.ts`: `report(impression)` forwards only paid impressions (ILRD) to RevenueCat `AdTracker`; best-effort + non-blocking; dedup by `eventId` (in-memory + small persisted ring) for duplicate REDUCTION (not remote exactly-once); skip gracefully when RevenueCat not configured; optional non-PII diagnostics (`lastReportedAt`, counts)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, P4, P5, P10, P14_
  - [x]* 3.2 Unit tests for AdRevenueTracker
    - only paid/revenue events reported (non-revenue callbacks ignored); dedup across retry/remount/relaunch by eventId; failure swallowed (non-blocking); not-configured skips; metadata-only payload (no PII)
    - _Requirements: 3.4, 3.5, P4, P5, P10, P14_

- [x] 4. Ad provider seam (interface + mock + AdMob + factory)
  - [x] 4.1 Implement MockAdProvider
    - Create `apps/mobile/src/screens/ads/providers/mock.provider.ts`: implements `AdProvider`; deterministic placeholder view; can emit synthetic `PaidImpression`; used in tests and when explicitly selected
    - _Requirements: 2.2, 2.4, P3_
  - [x] 4.2 Implement AdMobAdProvider
    - Create `apps/mobile/src/screens/ads/providers/admob.provider.ts`: implements `AdProvider` via `react-native-google-mobile-ads`; `initialize(context)` idempotent; `renderAdView` returns a banner/native view; emits paid-impression (ILRD) via the callback; OWNS the native ad object lifecycle and releases native resources on unmount; never throws into render
    - _Requirements: 1.1, 2.2, 3.1, 5.3, 6.5, P2_
  - [x] 4.3 Implement the provider factory
    - Create `apps/mobile/src/screens/ads/ad-provider.factory.ts`: `createAdProvider()` - test/CI -> Mock; development -> AdMob with TEST unit ids (or mock/disabled if config absent); production -> AdMob when config valid, else DISABLED (NEVER the mock); driven by `EXPO_PUBLIC_ADS_PROVIDER`/config
    - _Requirements: 2.4, 6.4, 7.4, P3, P8_
  - [x]* 4.4 Unit tests for provider factory & mock
    - factory selection matrix (test->mock, dev->admob-test/mock-if-absent, prod-missing->disabled-never-mock); mock renders deterministically and emits synthetic impressions
    - _Requirements: 2.4, 7.4, P3, P8_

- [x] 5. Checkpoint - pure core + provider seam compile and unit tests pass
  - Ensure types, constants, personalization, attribution, tracker, mock/AdMob providers, and factory compile (mobile `tsc --noEmit`) and their unit tests pass; ask the user if questions arise.

- [x] 6. Ads store & consent
  - [x] 6.1 Implement useAds Zustand store
    - Create `apps/mobile/src/screens/ads/useAds.ts`: state (`provider`, `providerReady`, `consent`, `personalizationMode`); `initialize(appUserId, platform)` builds `AdProviderContext` via `deriveAdAttributionId`, resolves consent, and inits the factory provider (idempotent, independent of the subscriptions lifecycle, resilient to init failure -> providerReady=false); `resolveConsent()` reads ATT (iOS) + UMP once per session and derives `personalizationMode(platform, consent)`; `reportImpression()` delegates to `AdRevenueTracker`; `reset()`
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 3.1, P4, P6, P9_
  - [x]* 6.2 Unit tests for useAds
    - initialize idempotent + independent of subscriptions + failure -> providerReady false; resolveConsent once per session + platform-aware mode; reportImpression delegates and never throws
    - _Requirements: 5.3, 5.4, 4.5, P4_

- [x] 7. Slot lifecycle hook & AdBanner
  - [x] 7.1 Implement useAdSlot hook
    - Create `apps/mobile/src/screens/ads/useAdSlot.ts`: computes the layered render decision (`adsEnabled` from `useAdVisibility` AND `providerReady` AND `placementAllowed` AND `consentResolved`); requests an ad AT MOST ONCE per mount for the slot key (no re-request on list re-render); releases on unmount; background/foreground releases then legitimately re-requests without a duplicate SIMULTANEOUS request; exposes `onPaidImpression` wired to `useAds.reportImpression`
    - _Requirements: 1.2, 1.3, 6.1, 6.3, 6.4, P1, P11, P13_
  - [x] 7.2 Implement AdBanner component
    - Create `apps/mobile/src/screens/ads/components/AdBanner.tsx`: renders `provider.renderAdView({...})` for the resolved provider/format/personalizationMode; collapses (renders nothing) on `onNoFill`/`onError`; imports NO RevenueCat; dark design tokens
    - _Requirements: 1.4, 1.5, 2.6, 7.2, P7_
  - [x]* 7.3 Unit tests for useAdSlot & AdBanner
    - shouldRender layered decision (false when any condition unmet); request-once-per-mount + release-on-unmount + no re-request on re-render; AdBanner collapses on no-fill/error; AdBanner has no RevenueCat import
    - _Requirements: 1.4, 1.5, 6.1, P1, P7, P13_

- [x] 8. Radar integration (fill the AdSlot)
  - [x] 8.1 Wire AdSlot to real ads
    - Edit `apps/mobile/src/screens/radar/components/list/AdSlot.tsx`: replace the placeholder body with `<AdBanner>` driven by `useAdSlot('radar-list')`; return null when `shouldRender` is false; PRESERVE the container, "Sponsored" label, `accessibilityLabel`, and `testID="ad-slot"`; keep the Cleaner-only invariant explicit; do NOT change `OfferListView` placement or the `AD_SLOT_*` cadence
    - _Requirements: 1.1, 1.2, 1.6, P1, P11_
  - [x] 8.2 Extend radar adSlot i18n (en + es)
    - Update `apps/mobile/src/i18n/locales/{en,es}/radar.json`: extend `radar.adSlot.*` with any error/empty-state keys the AdBanner/AdSlot need (keep `sponsored`, `placeholder`, `a11yLabel`); keep en/es in parity
    - _Requirements: 7.1, 8.1_

- [x] 9. Native SDK integration & test mocks
  - [x] 9.1 Add the AdMob SDK + Expo config plugin
    - Add `react-native-google-mobile-ads` (validated version) to `apps/mobile`; configure the Expo config plugin with the AdMob app ids from `EXPO_PUBLIC_ADMOB_*` in `app.config`; document the prebuild/EAS requirement (no impact on Jest/CI)
    - _Requirements: 5.2, 6.1, 6.5_
  - [x] 9.2 Mock the native ad + UMP modules in Jest
    - Update `apps/mobile/src/__mocks__/setup.ts`: mock `react-native-google-mobile-ads` and the UMP module (default-export shape mirroring the existing purchases/purchases-ui mocks) so unit tests run without a native build
    - _Requirements: 2.4, P3_

- [x] 10. Checkpoint - full ads UX integrated on mobile
  - Ensure the store, slot hook, AdBanner, radar wiring, i18n, and mocks work together; ads render via the mock in tests, gate on `ad_free`, and never break the radar; mobile `tsc --noEmit` + ESLint clean; ask the user if questions arise.

- [x] 11. Property-Based Tests (fast-check)
  - [x]* 11.1 Property: Eligibility authority
    - **Property 1: Eligibility is ad_free, not PRO** - **Validates: Requirements 1.2, 1.3** - random subscription views (any PRO/role combo); an ad is eligible iff `ad_free` is absent; an active `ad_free` never shows ads regardless of PRO
  - [x]* 11.2 Property: Consent correctness (platform-aware)
    - **Property 6: Consent Correctness** - **Validates: Requirements 4.1, 4.2, 4.4** - total over platform x ATT x UMP; personalized only when platform-relevant inputs permit; UNRESOLVED -> no personalized request; Android-unavailable-ATT never a denial
  - [x]* 11.3 Property: No double counting / impression uniqueness
    - **Properties 5 & 14** - **Validates: Requirements 3.5** - arbitrary interleavings of report/retry/remount/relaunch by `eventId` never double-report
  - [x]* 11.4 Property: Slot lifecycle idempotency
    - **Property 13: Slot Lifecycle Idempotency** - **Validates: Requirements 6.1, 6.3** - arbitrary mount/unmount/re-render/background sequences -> at most one active SIMULTANEOUS request per slot key; a post-release foreground re-request is not a duplicate
  - [x]* 11.5 Property: Placement unchanged
    - **Validates: Requirements 1.6** - reuse radar `computeAdSlotPositions` oracle to assert this module does not alter ad-slot placement cadence

- [x] 12. Integration & Scenario Tests
  - [x]* 12.1 Integration: free-tier Cleaner sees an ad, PRO/ad_free does not
    - `ad_free` absent -> AdSlot renders AdBanner; `ad_free` active -> AdSlot renders nothing; host_pro-only free-Cleaner (no ad_free) -> still sees ads
    - _Requirements: 1.1, 1.2, P1_
  - [x]* 12.2 Integration: paid impression -> AdRevenueTracker -> RevenueCat (mock)
    - a MockAdProvider paid impression flows through `useAds.reportImpression` to the tracker; duplicate eventId reported once; tracker failure does not break the slot
    - _Requirements: 3.1, 3.5, P4, P5, P14_
  - [x]* 12.3 Integration: no-fill and provider-init failure degrade gracefully
    - no-fill -> AdSlot collapses, list intact; provider init failure -> providerReady false, radar renders offers only, no crash
    - _Requirements: 1.5, 5.4, P7_
  - [x]* 12.4 Integration: consent gates personalization, not eligibility
    - consent UNRESOLVED -> no personalized request but eligible free user still monetizable per framework; `ad_free` user never shown ads regardless of consent
    - _Requirements: 4.3, 4.4, P6_

- [x] 13. Final Checkpoint - all tests pass, CI-equivalent green
  - Ensure the full mobile suite passes and the CI-equivalent commands are green locally (mobile `tsc --noEmit` + ESLint + Jest); `services/api` and `packages/shared` unchanged; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability; property tests cite the design's P1-P14.
- Checkpoints ensure incremental validation.
- This spec is **mobile-only and client-side**: no NestJS module, no DB, no migration, no endpoint. `ad_free` eligibility (revenuecat-subscriptions) and `AD_SLOT_*` placement (offer-radar) already exist and are consumed, not modified.
- The mediation provider is **AdMob (MVP)** behind the abstract `AdProvider`; RevenueCat is analytics-only via `AdTracker`. Ad revenue is not an IAP and never touches `SUBSCRIPTION_TIER`.
- Eligibility authority is the `ad_free` entitlement via `useAdVisibility` - never PRO. The layered render decision (`adsEnabled AND providerReady AND placementAllowed AND consentResolved`) governs whether a slot shows an ad.
- Attribution identity is a privacy-scoped pseudonym (not the raw UUID, not anonymization). Ad-revenue tracking is best-effort with local dedup (duplicate reduction, not remote exactly-once).
- Consent is platform-aware (ATT is iOS-only) and shapes personalization, never eligibility.
- All ad ids/keys come from `EXPO_PUBLIC_*`; development uses AdMob TEST unit ids; a production build with missing config disables ads (never falls back to the mock).
- Credentials needed at release time (not for code/tests): AdMob account + per-platform app ids and ad unit ids, and the RevenueCat ad-tracking setup. Tests run against `MockAdProvider` with the native SDK mocked.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["6.1", "6.2"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["8.1", "8.2"] },
    { "id": 7, "tasks": ["9.1", "9.2"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3", "12.4"] }
  ]
}
```

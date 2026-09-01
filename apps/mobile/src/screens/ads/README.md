# Ads Screens (Mobile)

## Purpose

The display-ads feature module for the free tier. It fills the placeholder `AdSlot` in the Cleaner radar list with a real ad served through an abstract `AdProvider` seam (concrete: AdMob, Mock), reports each paid impression to RevenueCat for unified LTV, and gates everything behind the existing `ad_free` entitlement. It is mobile-only and client-side: no backend, no DB, no migration. Eligibility is `ad_free` (never PRO), consent shapes personalization (never eligibility), and every failure degrades to "no ad shown, radar functional".

## Files

| File | Responsibility |
|------|---------------|
| `ads.types.ts` | Pure domain types: `AdFormat`, `PersonalizationMode`, `ConsentState`, `AdProviderContext`, `PaidImpression`, `AdViewProps`, `AdProvider` interface (no SDK imports) |
| `ads.constants.ts` | `EXPO_PUBLIC_*` app/unit ids per platform, official AdMob test unit ids, provider selection, `resolveBannerUnitId` / `hasProductionAdMobConfig` helpers, i18n keys |
| `personalization.ts` | Pure `derivePersonalizationMode(platform, consent)` — platform-aware (ATT iOS-only + UMP), never gates eligibility |
| `ad-attribution.ts` | Pure `deriveAdAttributionId(appUserId)` — privacy-scoped, purpose-separated pseudonym (salted SHA-256 digest), never the raw UUID |
| `ad-revenue-tracker.ts` | `AdRevenueTracker`: forwards paid impressions (ILRD) to RevenueCat's `AdTracker` sink; deduped by `eventId` via an in-memory + bounded persisted ring (relaunch-safe), best-effort and non-blocking (failures swallowed), skips gracefully when RevenueCat is unconfigured. Collaborators (`AdRevenueSink`, `KeyValueStore`) injected via `createAdRevenueTracker` for testability |
| `consent.ts` | Reads the device consent state (ATT on iOS + UMP) behind a guarded native seam so it runs in CI without a native build; supplies `readConsentState(platform)` consumed by the store to derive personalization |
| `ad-provider.factory.ts` | `createAdProvider(platform)` — selects `AdMobAdProvider` \| `MockAdProvider` from config/env; returns `null` when ads are disabled so the store fails into "no ad shown" |
| `useAds.ts` | Zustand store owning the provider lifecycle, consent, and impression reporting (`provider`, `providerReady`, `consent`, `personalizationMode`); `initialize` / `resolveConsent` / `reportImpression` / `reset`. Independent of the subscriptions lifecycle; eligibility is never read here |
| `providers/mock.provider.ts` | `MockAdProvider` — deterministic `AdProvider` with no native SDK: stable placeholder view (`MOCK_AD_VIEW_TEST_ID`) plus `buildSyntheticImpression` for zero-real-request rendering in CI; selected under test or `EXPO_PUBLIC_ADS_PROVIDER=mock`, never a production fallback |
| `providers/admob.provider.ts` | `AdMobAdProvider` — concrete provider backed by Google AdMob (`react-native-google-mobile-ads`, loaded defensively); renders a banner, forwards only paid impressions (ILRD), owns native ad lifecycle, collapses the slot on no-fill/error, imports no RevenueCat and never decides eligibility |
| `useAdSlot.ts` | Per-slot lifecycle: request-once-per-mount guard, release on unmount, and the layered render decision (`adsEnabled AND providerReady AND placementAllowed AND consentResolved`). Reads eligibility only from `useAdVisibility` (never PRO/tier), asserts the Cleaner-only radar slot invariant, and wires `onPaidImpression` to `useAds.reportImpression` (never calls RevenueCat directly) |
| `components/AdBanner.tsx` | Renders the provider ad view; collapses on no-fill/error; imports no RevenueCat |

## Dependencies

- `revenuecat-subscriptions` — supplies `useAdVisibility` (the sole `ad_free` eligibility authority) and the authenticated `app_user_id`. This module consumes eligibility; it never re-decides it.
- `offer-radar` — owns `OfferListView`, `AdSlot` placement, and the `AD_SLOT_*` cadence; this module only fills the slot.
- Google AdMob (`react-native-google-mobile-ads`) + UMP — the MVP provider and consent SDK (native modules, mocked in tests).
- RevenueCat (`AdTracker`) — analytics system of record for ad revenue; receives reported paid impressions.

## Render Decision

An ad renders only when `adsEnabled AND providerReady AND placementAllowed AND consentResolved`. Any missing condition means no ad shown and the radar stays fully functional. Eligibility (`ad_free` absent) is necessary but not sufficient.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EXPO_PUBLIC_ADMOB_IOS_APP_ID` | AdMob application id (iOS) | For real ads |
| `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID` | AdMob application id (Android) | For real ads |
| `EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID` | Banner ad unit id (iOS) | For real ads |
| `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID` | Banner ad unit id (Android) | For real ads |
| `EXPO_PUBLIC_ADS_PROVIDER` | Provider selector (default `admob`; `mock` for local/dev) | No |
| `EXPO_PUBLIC_ADS_ENABLED` | Operational UI kill-switch (not a security control) | No |

In development, absent unit ids fall back to AdMob official test unit ids; a production build with missing config disables ads (never falls back to the mock).

## Testing

Tests live in `__tests__/`. Unit specs cover the store, the slot hook, the banner, and the pure helpers. Alongside them, property-based suites (fast-check, 100+ iterations per property) assert the module's correctness properties over randomized inputs.

| File | Responsibility |
|------|---------------|
| `__tests__/useAds.spec.ts` | Unit tests for the Zustand store: provider lifecycle, consent resolution, impression reporting, and reset |
| `__tests__/useAdSlot.spec.ts` | Unit tests for the per-slot lifecycle: request-once guard, release on unmount, and the layered render decision |
| `__tests__/AdBanner.spec.tsx` | Unit tests for the banner: renders the provider view, collapses on no-fill/error |
| `__tests__/ad-provider.factory.spec.ts` | Unit tests for provider selection from config/env (AdMob / Mock / disabled) |
| `__tests__/ad-revenue-tracker.spec.ts` | Unit tests for paid-impression forwarding, dedup by `eventId`, and graceful skip when RevenueCat is unconfigured |
| `__tests__/ad-attribution.spec.ts` | Unit tests for the privacy-scoped attribution pseudonym derivation |
| `__tests__/personalization.spec.ts` | Unit tests for platform-aware personalization mode derivation (ATT iOS-only + UMP) |
| `__tests__/ads-eligibility.property.spec.ts` | Property-based tests (fast-check) for P1 eligibility authority: an ad renders iff `adsEnabled AND providerReady AND placementAllowed AND consentResolved`, independent of PRO/role/subscription; active `ad_free` never renders |
| `__tests__/consent.property.spec.ts` | Property-based tests (fast-check) for P6 consent correctness: `derivePersonalizationMode` is total and platform-aware, never PERSONALIZED while unresolved, and Android is invariant to an `unavailable` ATT status |
| `__tests__/impression-dedup.property.spec.ts` | Property-based tests (fast-check) for P5/P14: each distinct `eventId` is forwarded to the RevenueCat sink at most once, including across a simulated relaunch that rehydrates from the same persisted backing |
| `__tests__/placement.property.spec.ts` | Property-based tests (fast-check) for slot placement (Req 1.6): the ads module only fills slots and leaves the radar's `computeAdSlotPositions` cadence intact |
| `__tests__/slot-lifecycle.property.spec.ts` | Property-based tests (fast-check) for P13 lifecycle idempotency: re-render and unmount/remount sequences never throw and keep `shouldRender` stable (request-once-per-mount) |
| `__tests__/integration-eligibility.spec.tsx` | Integration test driving the real `useAdVisibility` + `ad_free` path end-to-end through `AdSlot`: renders for free users, renders nothing when `ad_free` is active, still shows ads to a PRO-but-not-`ad_free` user (P1) |
| `__tests__/integration-consent-gating.spec.ts` | Integration test proving consent gates personalization, not eligibility: an eligible free user with `personalizationMode = UNRESOLVED` still renders once `consentResolved` is true (P6) |
| `__tests__/integration-degradation.spec.ts` | Integration test for graceful degradation (P7): no-fill collapses the banner and provider init failure fails safe (providerReady=false), never crashing the radar |
| `__tests__/integration-impression-flow.spec.ts` | Integration test for the paid-impression flow (P4/P5/P14): `reportImpression` delegation plus the real `createAdRevenueTracker` proving event-id dedup and non-throwing behavior on a failing sink |

## Spec

Full design, correctness properties (P1–P14), and the implementation plan live in `.kiro/specs/revenuecat-ads/`.

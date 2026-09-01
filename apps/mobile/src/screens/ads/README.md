# Ads Screens (Mobile)

## Purpose

The display-ads feature module for the free tier. It fills the placeholder `AdSlot` in the Cleaner radar list with a real ad served through an abstract `AdProvider` seam (concrete: AdMob, Mock), reports each paid impression to RevenueCat for unified LTV, and gates everything behind the existing `ad_free` entitlement. It is mobile-only and client-side: no backend, no DB, no migration. Eligibility is `ad_free` (never PRO), consent shapes personalization (never eligibility), and every failure degrades to "no ad shown, radar functional".

## Files

| File | Responsibility |
|------|---------------|
| `ads.types.ts` | Pure domain types: `AdFormat`, `PersonalizationMode`, `ConsentState`, `AdProviderContext`, `PaidImpression`, `AdViewProps`, `AdProvider` interface (no SDK imports) |

> The remaining files below are planned by `.kiro/specs/revenuecat-ads/design.md` and not yet implemented.

| Planned file | Responsibility |
|------|---------------|
| `ads.constants.ts` | `EXPO_PUBLIC_*` app/unit ids per platform, test unit ids, provider selection, i18n keys |
| `useAds.ts` | Zustand store: `providerReady`, consent, `personalizationMode`; `initialize` / `resolveConsent` / `reportImpression` / `reset` |
| `ad-provider.factory.ts` | Selects `AdMobAdProvider` \| `MockAdProvider` from config/env |
| `personalization.ts` | Pure `derivePersonalizationMode(platform, consent)` (ATT iOS-only + UMP) |
| `ad-attribution.ts` | Pure `deriveAdAttributionId(appUserId)` — privacy-scoped pseudonym, not the raw UUID |
| `ad-revenue-tracker.ts` | `AdRevenueTracker`: dedup by `eventId` → RevenueCat `AdTracker` (best-effort, non-blocking) |
| `useAdSlot.ts` | Per-slot request-once lifecycle, release on unmount, layered render decision |
| `providers/admob.provider.ts` | `AdMobAdProvider` via `react-native-google-mobile-ads` |
| `providers/mock.provider.ts` | `MockAdProvider` — deterministic placeholder + synthetic impressions for tests |
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

## Spec

Full design, correctness properties (P1–P14), and the implementation plan live in `.kiro/specs/revenuecat-ads/`.

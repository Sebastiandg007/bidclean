# Design Document

## Overview

The `revenuecat-ads` module makes the free tier **monetizable through display advertising**. It replaces the placeholder `AdSlot` in the Cleaner radar list with a real ad served by a mediation network (Google AdMob in the MVP), reports each paid impression's revenue to RevenueCat for unified LTV, and gates everything behind the existing `ad_free` entitlement - all **client-side, mobile-only, with no backend work**.

The authority split, restated precisely (it drives the whole design):

- **The mediation provider (AdMob in the MVP) = the external source of the ad and the ad revenue.** It runs the auction, renders the creative, and pays the developer directly. Display-ad revenue is not an in-app purchase and never flows through store IAP.
- **RevenueCat = the analytics system of record for ad revenue.** It receives reported paid impressions (ILRD) via `AdTracker` and unifies them with subscription revenue. It never serves or gates ads.
- **`ad_free` (owned by `revenuecat-subscriptions`) = the single ad-eligibility authority.** This module renders ads only when `ad_free` is absent; it never re-decides eligibility and never treats PRO as the gate.

The design rests on eight hard rules:

1. **`ad_free`, not PRO, is the gate.** Eligibility comes solely from `useAdVisibility()` (which reads the `ad_free` mirror). Because Host and Cleaner subscriptions are independent, "PRO" is role-specific and never suppresses ads by itself. If the product wants "any PRO removes ads," that is expressed in `revenuecat-subscriptions` by granting `ad_free` - never inferred here.
2. **Layered render decision.** An ad renders only when `adsEnabled AND providerReady AND placementAllowed AND consentResolved`. Any missing condition means no ad shown, radar fully functional. Eligibility is necessary but not sufficient.
3. **Provider abstraction.** The radar depends only on an `AdProvider` interface. `AdMobAdProvider` is the concrete MVP implementation; `MockAdProvider` powers CI. Swapping the network never touches `AdSlot`/`OfferListView`.
4. **Tracking is a separate collaborator.** An `AdRevenueTracker` (not the `AdSlot`, not the provider render path) forwards paid impressions to RevenueCat. Rendering and tracking are independently testable and swappable.
5. **Only paid impressions are revenue.** Only provider callbacks explicitly identified as impression-level *revenue* events are reported; "ad loaded"/"ad opened"/non-revenue impressions are not.
6. **Impression uniqueness.** Every paid impression carries a client-generated event id; the tracker dedups within a persistence window so retries, remounts, and relaunches never double-count.
7. **Consent shapes personalization, not eligibility.** `personalizationMode` is derived from two distinct inputs - `trackingAuthorizationStatus` (iOS ATT) and `consentStatus` (UMP/GDPR). Until resolved, no personalized request is made; consent never decides whether an eligible free user is monetizable or whether an `ad_free` user sees ads (never).
8. **Fail into "no ad," never into a crash.** Provider init failure, no-fill, missing config, or a tracking error all degrade to "no ad shown" with a working radar. Ad revenue never entangles with `SUBSCRIPTION_TIER` or IAP.

### Terminology

> **Eligibility** = `adsEnabled` from `useAdVisibility` (no active `ad_free`). **Render decision** = the layered `adsEnabled AND providerReady AND placementAllowed AND consentResolved`. **AdProvider** = the abstraction the radar renders through. **Paid impression** = a provider callback carrying impression-level revenue (ILRD). **AdRevenueTracker** = the collaborator that reports paid impressions to RevenueCat's `AdTracker`. **personalizationMode** = `PERSONALIZED | NON_PERSONALIZED | UNRESOLVED`, derived from ATT + UMP. **Attribution identity** = a stable id associable with the RevenueCat `app_user_id`, not the raw internal UUID. **Placement** = where a slot appears (owned by `offer-radar`).

### Key Design Decisions

1. **Mobile-only feature module, no backend.** All logic lives under `apps/mobile/src/screens/ads/` (a new feature folder) plus the two radar seams (`AdSlot`, `OfferListView`). No NestJS module, no migration, no endpoint. `ad_free` already exists in `revenuecat-subscriptions`.
2. **`AdProvider` seam with `initialize(context)`.** Initialization takes an `AdProviderContext` (optional consent/personalization, platform, environment, attribution) - never a bare `userId` - so no provider is forced to require identity. Concrete `AdMobAdProvider` (real) + `MockAdProvider` (tests); a config-driven factory selects one, defaulting to AdMob and forcing the mock under test.
3. **Zustand ads store (`useAds`).** One store per domain (matching `useSubscription`/`usePayments`): holds `providerReady`, `personalizationMode`, `consent` inputs, and the actions `initialize`, `resolveConsent`, `reportImpression`. It owns provider lifecycle + consent, not the `AdSlot` component.
4. **`AdRevenueTracker` separate from provider and slot.** The provider emits a `PaidImpression`; the store's `reportImpression` delegates to `AdRevenueTracker`, which dedups by event id and calls RevenueCat. `AdSlot` never imports RevenueCat.
5. **Consent = two inputs, one derived mode.** `trackingAuthorizationStatus` (ATT, iOS) and `consentStatus` (UMP) are tracked separately; a pure `derivePersonalizationMode(platform, consent)` computes the mode (ATT is iOS-only). Personalized only when both permit; otherwise non-personalized (when the framework allows) or no request.
6. **Attribution identity is a privacy-scoped PSEUDONYM, not anonymization.** A pure `deriveAdAttributionId(appUserId)` produces the identifier passed to the provider; by default it does NOT hand the raw internal UUID to AdMob. It is a *pseudonymous* id (stable, re-derivable given the inputs), not anonymized, built with purpose separation, e.g. `HMAC(adAttributionSecret, appUserId + ':ads')` rather than a bare `SHA256(uuid)`, so the same user never accidentally shares one identifier across contexts and the raw id is never leaked unless the privacy architecture explicitly approves. Same *user*, not the same raw id.
7. **Lifecycle idempotency in the slot.** `AdSlot` requests an ad once per mount for its slot key; a `useAdSlot` hook guards against re-request on list re-render and releases the ad view on unmount. Impression dedup is enforced independently by `AdRevenueTracker`.
8. **Placement stays in `offer-radar`.** `AD_SLOT_FIRST_POSITION`/`AD_SLOT_INTERVAL` and `injectAdSlots` are unchanged; this module only changes what `AdSlot` renders. The `computeAdSlotPositions` oracle in radar's property tests remains valid.
9. **Config via `EXPO_PUBLIC_*`, test units in dev.** App ids + ad unit ids (banner/native, per platform) come from env; development uses AdMob's official test unit ids so no real ads serve in CI/dev; **missing/invalid PRODUCTION config disables ads (never falls back to the mock provider)**; the mock is used only under test or when explicitly selected.
10. **Native module, mocked in Jest.** `react-native-google-mobile-ads` (+ UMP) is a native module requiring an Expo config plugin / prebuild; unit tests run against `MockAdProvider` and a Jest mock in `src/__mocks__/setup.ts`, exactly as `react-native-purchases` is mocked today.

### Responsibility Matrix

| Responsibility | revenuecat-ads | revenuecat-subscriptions | offer-radar | AdMob | RevenueCat |
|----------------|:---:|:---:|:---:|:---:|:---:|
| Decide ad eligibility (`ad_free`) | consumes | YES (supplies via `useAdVisibility`) | no | no | source of `ad_free` |
| Decide slot placement | no | no | YES (`injectAdSlots`, cadence) | no | no |
| Render ad creative | YES (via provider) | no | hosts the slot | serves creative | no |
| Run ad auction / pay revenue | no | no | no | YES | no |
| Consent / ATT flow | YES (client) | no | no | UMP SDK provides | no |
| Report ad revenue (unified LTV) | YES (`AdRevenueTracker`) | no | no | emits ILRD | receives via `AdTracker` |
| Attribution identity | YES (derives) | owns `app_user_id` | no | consumes id | keys revenue by id |
| Backend / server logic | none | owns mirror | owns offers | no | no |

## Architecture

### Module Placement

`
apps/mobile/src/screens/ads/                     (NEW feature folder - mobile only)
|-- ads.types.ts             (AdProvider, AdProviderContext, PaidImpression, AdFormat, PersonalizationMode, ConsentState)
|-- ads.constants.ts         (EXPO_PUBLIC_* app/unit ids per platform; test unit ids; provider selection; i18n keys)
|-- useAds.ts                (Zustand store: providerReady, consent, personalizationMode; initialize/resolveConsent/reportImpression)
|-- ad-provider.factory.ts   (selects AdMobAdProvider | MockAdProvider from config/env)
|-- personalization.ts       (pure: derivePersonalizationMode(platform, consent) -> PersonalizationMode)
|-- ad-attribution.ts        (pure: deriveAdAttributionId(appUserId) -> privacy-scoped id)
|-- ad-revenue-tracker.ts    (AdRevenueTracker: dedup by event id -> RevenueCat AdTracker; best-effort)
|-- useAdSlot.ts             (hook: per-slot request-once lifecycle, release on unmount, no re-request on re-render)
|-- providers/
|   |-- admob.provider.ts    (AdMobAdProvider: react-native-google-mobile-ads banner/native + paid-impression callback)
|   `-- mock.provider.ts     (MockAdProvider: deterministic placeholder + synthetic PaidImpression for tests)
|-- components/
|   `-- AdBanner.tsx         (renders the provider ad view for a resolved AdProvider/format; no RevenueCat import)
`-- __tests__/               (useAds, personalization, ad-attribution, ad-revenue-tracker, useAdSlot, AdBanner, providers)

apps/mobile/src/screens/radar/components/list/AdSlot.tsx    (EDIT: placeholder body -> <AdBanner> via useAdSlot; chrome/testID kept)
apps/mobile/src/screens/radar/components/list/OfferListView.tsx  (UNCHANGED placement; renderItem still returns <AdSlot/>)
apps/mobile/src/screens/radar/radar.constants.ts           (UNCHANGED cadence AD_SLOT_FIRST_POSITION/INTERVAL)
apps/mobile/src/i18n/locales/{en,es}/radar.json            (EDIT: extend radar.adSlot.* with error/empty keys)
apps/mobile/src/__mocks__/setup.ts                         (EDIT: mock react-native-google-mobile-ads + UMP)
apps/mobile/app.config + package.json                      (EDIT: add SDK dep + Expo config plugin, app ids)
.env.example                                               (EDIT: EXPO_PUBLIC_ADMOB_* app/unit ids)
`

### High-Level Data Flow

`
App startup (authenticated identity available)
   |
   v
useAds.initialize(appUserId, platform)
   |   context = { platform, environment, personalizationMode?, attributionId: deriveAdAttributionId(appUserId) }
   |   -- resolveConsent(): read ATT (iOS) + UMP -> derivePersonalizationMode -> personalizationMode
   |   -- createAdProvider().initialize(context)   -> providerReady = true (or false on failure)
   v
Radar list renders (Cleaner)
   |
   v
OfferListView.injectAdSlots(offers, adsEnabled AND NOT adsLoading)   [offer-radar, unchanged]
   |   renderItem(type:ad) -> <AdSlot/>
   v
AdSlot -> useAdSlot(slotKey)
   |   render decision = adsEnabled AND providerReady AND placementAllowed AND consentResolved
   |   if false -> render nothing (list unaffected)
   |   else request-once -> <AdBanner provider format personalizationMode/>
   v
AdProvider serves creative (AdMob) -- no-fill -> collapse (render nothing)
   |
   |  onPaidImpression(PaidImpression{ eventId, revenueMicros, currency, network, adUnitId, ts })
   v
useAds.reportImpression(impression) -> AdRevenueTracker
   |   dedup by eventId (persistence window) -> RevenueCat AdTracker.trackAdImpression(...)   [best-effort, non-blocking]
   v
RevenueCat Charts: ad revenue unified with subscription revenue per user
`

## Components and Interfaces

### 1. Types (`ads.types.ts`)

`typescript
/** Which ad format a slot renders. */
export const AdFormat = { BANNER: "BANNER", NATIVE: "NATIVE" } as const;
export type AdFormat = (typeof AdFormat)[keyof typeof AdFormat];

/** Personalization derived from consent inputs; NOT an eligibility flag. */
export const PersonalizationMode = {
  PERSONALIZED: "PERSONALIZED",
  NON_PERSONALIZED: "NON_PERSONALIZED",
  UNRESOLVED: "UNRESOLVED",
} as const;
export type PersonalizationMode = (typeof PersonalizationMode)[keyof typeof PersonalizationMode];

/** iOS App Tracking Transparency status (subset we act on). */
export type TrackingAuthorizationStatus =
  | "authorized" | "denied" | "restricted" | "not_determined" | "unavailable";

/** UMP / GDPR consent status (subset we act on). */
export type ConsentStatus = "obtained" | "not_required" | "required" | "unknown";

/** The two distinct consent inputs, tracked separately (never collapsed). */
export interface ConsentState {
  readonly trackingAuthorizationStatus: TrackingAuthorizationStatus;
  readonly consentStatus: ConsentStatus;
}

/** Context passed to a provider on init - optional fields so no provider requires identity. */
export interface AdProviderContext {
  readonly platform: "ios" | "android";
  readonly environment: "development" | "production";
  readonly personalizationMode?: PersonalizationMode;
  /** Privacy-scoped attribution id (NOT the raw internal UUID). */
  readonly attributionId?: string;
}

/** A paid, revenue-bearing impression reported by a provider. */
export interface PaidImpression {
  /** Client-generated unique id for dedup (one impression -> one report). */
  readonly eventId: string;
  readonly revenueMicros: number;
  readonly currency: string;
  readonly network: string;
  readonly adUnitId: string;
  readonly format: AdFormat;
  readonly occurredAtMs: number;
}

/** Props a concrete ad view receives (rendered by the provider through AdBanner). */
export interface AdViewProps {
  readonly format: AdFormat;
  readonly personalizationMode: PersonalizationMode;
  readonly onPaidImpression: (impression: PaidImpression) => void;
  readonly onNoFill: () => void;
  readonly onError: (error: unknown) => void;
}

/** The abstraction the radar renders through; concrete impls: AdMob, Mock. */
export interface AdProvider {
  readonly name: string;
  initialize(context: AdProviderContext): Promise<void>;
  isReady(): boolean;
  /** Returns the ad view component for a slot, or null when unavailable. */
  renderAdView(props: AdViewProps): React.ReactElement | null;
}
`

### 2. Provider factory (`ad-provider.factory.ts`)

`typescript
/**
 * Selects the concrete AdProvider from config/env. Defaults to AdMob; forces the mock provider
 * under test (NODE_ENV/JEST) or when required ad config is absent, so CI never issues real requests.
 */
export function createAdProvider(): AdProvider;
`

- Provider selection is unambiguous per environment (a production build can NEVER fall back to the mock):
  - **Test/CI** => `MockAdProvider`.
  - **Development** => `AdMobAdProvider` with AdMob's official TEST ad unit ids when app config is valid; `mock`/disabled only if explicitly selected or config absent.
  - **Production** => `AdMobAdProvider` when config is valid; **missing/invalid config => ads DISABLED (never the mock)**. Ads off, radar unaffected (Req 7.4).

### 3. Personalization (pure) (`personalization.ts`)

`typescript
/**
 * Derive the personalization mode, PLATFORM-AWARE (ATT is iOS-only).
 * - iOS: consider BOTH trackingAuthorizationStatus (ATT) and consentStatus (UMP).
 * - Android: ATT does not apply (expect 'unavailable'); decide from consentStatus (UMP/regional).
 * Personalized only when the platform-relevant inputs permit; UNRESOLVED until known; else NON_PERSONALIZED.
 */
export function derivePersonalizationMode(
  platform: 'ios' | 'android',
  consent: ConsentState,
): PersonalizationMode;
`

- **iOS:** ATT `authorized` AND UMP `obtained`/`not_required` => `PERSONALIZED`; ATT `denied`/`restricted` OR UMP `required`-not-obtained => `NON_PERSONALIZED`; ATT/UMP `not_determined`/`unknown` => `UNRESOLVED`.
- **Android:** ATT is `unavailable` and IGNORED; UMP `obtained`/`not_required` => `PERSONALIZED`; UMP `required`-not-obtained => `NON_PERSONALIZED`; UMP `unknown` => `UNRESOLVED` (an `unavailable` ATT on Android is never treated as a denial).
- Pure and fully unit/property testable (no SDK).

### 4. Attribution identity (pure) (`ad-attribution.ts`)

`typescript
/**
 * Produce the privacy-scoped PSEUDONYMOUS attribution id passed to the ad network. This is NOT the
 * raw internal UUID and NOT anonymization: it is a stable, re-derivable pseudonym built with
 * purpose separation, e.g. HMAC(adAttributionSecret, appUserId + ':ads'), so the same user never
 * accidentally shares one identifier across contexts. Never returns internal identifiers unless
 * privacy-approved config opts in.
 */
export function deriveAdAttributionId(appUserId: string): string;
`

### 5. AdRevenueTracker (`ad-revenue-tracker.ts`)

`typescript
/**
 * Reports paid impressions to RevenueCat AdTracker. Kept separate from AdProvider/AdSlot so
 * rendering and revenue tracking are independently testable. Makes a BEST-EFFORT attempt to
 * report each impression once, with local duplicate protection via an eventId dedup ring;
 * non-blocking (a failure never breaks rendering). Note: with a purely client-side remote call,
 * exactly-once delivery to RevenueCat is NOT guaranteed unless RevenueCat provides idempotency -
 * the local dedup reduces (not eliminates) duplicates, and tracking is treated as non-critical.
 */
export interface AdRevenueTracker {
  report(impression: PaidImpression): Promise<void>;
}
`

- Maintains a bounded seen-`eventId` set (in-memory + a small persisted store - AsyncStorage is acceptable for a small ring; SQLite/MMKV if a more robust local store is already available) so a relaunch after a paid impression does not re-report (Req 3.5 / P5 / P14). This is best-effort duplicate REDUCTION, not a remote exactly-once guarantee.
- Skips gracefully when RevenueCat is not configured (Req 3.6).
- MAY keep lightweight local diagnostics (e.g. `lastReportedAt`, reported/duplicate counts) for observability; diagnostics are non-PII and never block reporting.

### 6. useAds store (`useAds.ts`)

`typescript
export interface AdsState {
  provider: AdProvider | null;
  providerReady: boolean;
  consent: ConsentState;
  personalizationMode: PersonalizationMode;
}
export interface AdsActions {
  /** Init provider after auth identity is available - independent of subscriptions lifecycle. */
  initialize: (appUserId: string, platform: "ios" | "android") => Promise<void>;
  /** Resolve ATT (iOS only) + UMP, then derivePersonalizationMode(platform, consent). Once per session. */
  resolveConsent: () => Promise<void>;
  /** Forward a paid impression to the AdRevenueTracker (dedup + best-effort). */
  reportImpression: (impression: PaidImpression) => void;
  reset: () => void;
}
export type AdsStore = AdsState & AdsActions;
export const useAdsStore = create<AdsStore>((set, get) => ({ /* ... */ }));
`

- Mirrors the `useSubscription`/`usePayments` shape (state + actions + `reset`). Idempotent `initialize` (Req 5.3). Consent resolved once per session (Req 4.5), not per render.

### 7. useAdSlot hook + AdBanner (lifecycle-safe rendering)

`typescript
/**
 * Per-slot lifecycle: computes the layered render decision, requests an ad AT MOST ONCE per
 * mount for the slot key (no re-request on list re-render), and releases the ad view on unmount.
 */
export function useAdSlot(slotKey: string): {
  shouldRender: boolean;      // adsEnabled AND providerReady AND placementAllowed AND consentResolved
  provider: AdProvider | null;
  format: AdFormat;
  personalizationMode: PersonalizationMode;
  onPaidImpression: (i: PaidImpression) => void;
  onNoFill: () => void;
};
`

- `AdBanner` renders `provider.renderAdView({...})`; on `onNoFill`/`onError` it collapses (renders nothing) - Req 1.5 / P7. `AdBanner` imports no RevenueCat (Req 2.6).
- **Native resource ownership lives in the provider adapter, not in `AdSlot`.** `AdMobAdProvider` owns the native ad object lifecycle (`react-native-google-mobile-ads` native views have their own lifecycle) and SHALL release native resources when the React wrapper unmounts; `useAdSlot` signals mount/unmount, but the adapter is responsible for the actual native teardown.

### 8. AdSlot edit (radar seam)

`AdSlot.tsx` keeps its container, "Sponsored" label, `accessibilityLabel`, and `testID="ad-slot"`; only its placeholder body is replaced by `<AdBanner>` driven by `useAdSlot("radar-list")`. When `shouldRender` is false it returns null (the list is unaffected). It never calls RevenueCat directly.

## Data Models

There is **no persistent data model** in this spec (no DB, no migration). The only persisted state is the `AdRevenueTracker`'s bounded set of reported `eventId`s (device-local, e.g. AsyncStorage) used solely for impression dedup across relaunch - it holds ids only, never PII or revenue detail beyond what is needed to dedup.

## Correctness Properties

Each property maps to the design element that enforces it and the requirement it validates.

### Property 1: Eligibility is ad_free, not PRO

`useAdSlot.shouldRender` consumes `useAdVisibility().adsEnabled` only; no PRO/tier is read anywhere, and an active `ad_free` user is never shown ads. **Validates: Requirements 1.2, 1.3.**

### Property 2: Provider Abstraction

The radar depends only on the `AdProvider` interface via the factory; `AdSlot`/`AdBanner`/radar import no AdMob API. **Validates: Requirements 2.1, 2.3.**

### Property 3: Testability Without a Live Network

`MockAdProvider` + the Jest mock render deterministically; the factory forces the mock under test, so CI issues zero real ad requests. **Validates: Requirements 2.2, 2.4.**

### Property 4: Non-Blocking Tracking

`AdRevenueTracker.report` is best-effort; `reportImpression` never throws into the render path or the radar. **Validates: Requirements 3.3.**

### Property 5: No Double Counting

`AdRevenueTracker` dedups by `eventId` (in-memory + persisted ring) across retry/remount/relaunch. **Validates: Requirements 3.5.**

### Property 6: Consent Correctness

`derivePersonalizationMode(platform, consent)` derives the mode from ATT (iOS) + UMP, platform-aware; UNRESOLVED means no personalized request; consent never gates eligibility. **Validates: Requirements 4.1, 4.2, 4.4.**

### Property 7: Graceful No-Fill

`AdBanner` collapses on `onNoFill`/`onError`; the `shouldRender` gate prevents a broken/empty ad frame and never blocks the list. **Validates: Requirements 1.5.**

### Property 8: Configuration Integrity

`ads.constants.ts` reads all ids/keys from `EXPO_PUBLIC_*`; development uses test unit ids; missing config disables ads gracefully. **Validates: Requirements 6.1, 7.4.**

### Property 9: Identity Without Leakage

`deriveAdAttributionId` (privacy-scoped, not the raw UUID) feeds `AdProviderContext.attributionId`, associable with `app_user_id` without leaking internal ids. **Validates: Requirements 5.1, 6.2.**

### Property 10: No Sensitive Transmission

`PaidImpression` carries only ad metadata; the tracker sends metadata only, never card data, tokens, or unnecessary PII. **Validates: Requirements 3.4.**

### Property 11: Cleaner-Only Surface

The `placementAllowed` guard in `useAdSlot` plus radar-list-only mounting keeps ads Cleaner-only as an explicit invariant. **Validates: Requirements 1.7.**

### Property 12: No IAP Entanglement

The ad revenue path never touches the purchases SDK or `SUBSCRIPTION_TIER`; ad revenue is not an in-app purchase. **Validates: Requirements 3.1.**

### Property 13: Slot Lifecycle Idempotency

`useAdSlot` requests once per mount and releases on unmount; list re-render never re-requests. App background/foreground and unmount/remount transitions release then legitimately re-request, and SHALL NOT create duplicate SIMULTANEOUS requests for the same slot (a post-release re-request on foreground is expected, not a duplicate). **Validates: Requirements 6.1, 6.3.**

### Property 14: Impression Uniqueness

A single provider paid-impression event maps to at most one RevenueCat ad-revenue event (one `eventId` -> one report). **Validates: Requirements 3.5.**

## Error Handling

The module fails into "no ad shown, radar functional" for every failure mode; ad revenue never blocks or corrupts a user flow.

| Failure | Where handled | Behavior |
|---|---|---|
| Provider init fails | `useAds.initialize` | `providerReady=false`; `shouldRender` is false; radar renders offers only; no crash (Req 5.4) |
| Missing/invalid ad config | `ad-provider.factory` / `ads.constants` | Provider disabled (or test units in dev); ads off gracefully (Req 7.4) |
| No-fill or ad render error | `AdBanner` `onNoFill`/`onError` | Collapse the slot (render nothing); list unaffected (Req 1.5 / P7) |
| Consent unresolved | `useAdSlot` render decision | No personalized request; non-personalized only if the framework allows, else no ad (Req 4.4 / P6) |
| RevenueCat report fails / not configured | `AdRevenueTracker.report` | Swallow (best-effort, non-blocking); log for diagnostics; never surfaced to UI (Req 3.3 / 3.6 / P4) |
| Duplicate paid impression (retry/relaunch) | `AdRevenueTracker` dedup ring | Skip the duplicate; at most one report per `eventId` (Req 3.5 / P5 / P14) |
| List virtualization re-render | `useAdSlot` request-once guard | No duplicate ad request for the same visible slot key (Req 6.1 / P13) |
| Screen unmount / app background | `useAdSlot` cleanup + provider adapter | Release the native ad view/resources; on foreground a fresh request MAY be issued (not a duplicate); no leak, no duplicate SIMULTANEOUS request, no duplicate impression report (dedup by eventId) (Req 6.3-6.4) |

All errors are logged for diagnostics but never thrown into the render path or the radar list.
## Testing Strategy

- **Pure unit (no SDK):** `derivePersonalizationMode` (all ATT x UMP combinations), `deriveAdAttributionId` (stable, non-leaking), `AdRevenueTracker` dedup (retry/remount/relaunch simulation), factory selection (test -> mock, missing-config -> disabled).
- **Component (@testing-library/react-native):** `AdSlot` renders nothing when `shouldRender` false; renders `AdBanner` chrome when true; collapses on no-fill; `testID`/a11y preserved. `useAdSlot` requests once per mount, releases on unmount, no re-request on re-render.
- **Store:** `useAds.initialize` idempotent + independent of subscriptions; `resolveConsent` once per session; `reportImpression` delegates to tracker and never throws.
- **Property-based (fast-check):** P5 (dedup - arbitrary interleavings of report/retry/relaunch never double-count), P6 (personalization derivation total over ATT x UMP), P13 (arbitrary mount/unmount/re-render sequences -> at most one active request per slot key). Reuse radar existing `computeAdSlotPositions` oracle to assert placement is unchanged.
- **Mocks:** `react-native-google-mobile-ads` and the UMP module mocked in `src/__mocks__/setup.ts` (default-export shape mirroring the existing purchases/purchases-ui mocks); `MockAdProvider` used everywhere in CI. Zero real AdMob/RevenueCat calls in tests.
- **CI parity:** mobile `tsc --noEmit` clean, ESLint clean, full mobile Jest green; no change to `services/api` or `packages/shared`.

## Configuration

All from `EXPO_PUBLIC_*` (client-safe; no account secrets shipped - Req 6/7):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_ADMOB_IOS_APP_ID` | AdMob application id (iOS) |
| `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID` | AdMob application id (Android) |
| `EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID` | Banner ad unit id (iOS) |
| `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID` | Banner ad unit id (Android) |
| `EXPO_PUBLIC_ADS_PROVIDER` | Provider selector (default `admob`; `mock` for local/dev) |
| `EXPO_PUBLIC_ADS_ENABLED` | Operational UI feature flag / kill-switch (default true; false means no ads, radar unaffected). NOT a security control (see note). |

- In development, when a unit id is absent, the module uses AdMob official **test ad unit ids** so no real ads serve; when an app id is absent, ads are disabled gracefully.
- The AdMob app ids are also injected into the native build via the Expo config plugin (`app.config`), from the same env, at build time.
- `EXPO_PUBLIC_ADS_ENABLED` is an operational UI feature flag only and MUST NOT be treated as a monetization security control (it is client-side and changeable by rebuilding). Ad eligibility is always governed by `ad_free` via `useAdVisibility`.

## Dependencies

- **revenuecat-subscriptions (Spec 11):** supplies `useAdVisibility` (eligibility authority) and the authenticated `app_user_id` used to derive the attribution identity. This module consumes eligibility; it never re-decides it.
- **offer-radar (Spec 7):** owns `OfferListView`, `AdSlot` placement, and the `AD_SLOT_*` cadence; this module fills the slot.
- **Google AdMob (`react-native-google-mobile-ads`) + UMP:** the MVP provider (creative + revenue) and the consent SDK; native modules requiring an Expo config plugin / prebuild. Mocked in tests.
- **RevenueCat (`AdTracker`):** analytics system of record for ad revenue; receives reported paid impressions.
- **Expo / EAS:** config plugin + prebuild for the native ad SDK; unit tests run against the mock without a native build.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Native ad SDK not installable/buildable in CI | All tests use `MockAdProvider` + Jest mock; native build only for device/EAS, not CI |
| Double-counted revenue on retry/relaunch | Client `eventId` + persisted dedup ring in `AdRevenueTracker` (P5/P14) |
| Leaking internal user id to AdMob | `deriveAdAttributionId` returns a privacy-scoped id by default; raw id only if privacy-approved config opts in (P9) |
| Ads shown to a paying/ad_free user | Single eligibility source `useAdVisibility`; `shouldRender` gate; no PRO inference (P1) |
| Broken/empty ad frame on no-fill | `AdBanner` collapses; `shouldRender` gate (P7) |
| Duplicate requests from list virtualization | `useAdSlot` request-once-per-mount + release-on-unmount (P13) |
| Consent misuse (personalized without consent) | `derivePersonalizationMode`; UNRESOLVED means no personalized request (P6) |
| Coupling ads init to RevenueCat lifecycle | `useAds.initialize` is independent; shares identity only, not lifecycle |

## Out of Scope (design-level)

- Any backend/server work, DB, or migration (ad serving/consent/tracking are client-side; `ad_free` mirror already exists).
- Rewarded ads and ad-granted rewards (distinct RevenueCat feature; later spec).
- Host-side or non-radar ad surfaces (map view, other screens) - the abstraction allows adding them later.
- Mediation networks other than AdMob (the `AdProvider` seam permits them; only AdMob is implemented).
- Creating/configuring the AdMob account, ad units, and RevenueCat ad-tracking dashboard setup (done in dashboards; consumed here by configured id).

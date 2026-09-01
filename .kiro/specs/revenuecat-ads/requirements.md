# Requirements Document

## Introduction

The `revenuecat-ads` module makes the free tier **monetizable through display advertising**: free-tier users who do not pay for PRO/`ad_free` see real ads while they use the app, and BidClean earns per impression and click. It is the counterpart to `revenuecat-subscriptions` (Spec 11) in the monetization strategy — subscriptions monetize users who pay, ads monetize users who don't.

Today the ad surface is a **placeholder**: `apps/mobile/src/screens/radar/components/list/AdSlot.tsx` renders an empty "Sponsored" card in the Cleaner radar list (every 5th position, first at index 4), gated by `useAdVisibility` which already reads the real `ad_free` entitlement from the subscription mirror (`revenuecat-subscriptions`). Its own docstring states *"Actual ad SDK integration (RevenueCat Ads) will replace the placeholder content."* This spec replaces that placeholder with a **real ad, served by a mediation network, tracked in RevenueCat**.

**A precise clarification of what "RevenueCat Ads" is, to avoid an apparent contradiction:** RevenueCat does NOT serve or render the ad creative. Per RevenueCat's ad-monetization documentation, RevenueCat provides **ad revenue tracking** — you report impression-level ad revenue (ILRD) from your mediation network via its `AdTracker` so ad revenue appears alongside subscription/IAP revenue in RevenueCat Charts for a unified per-user LTV. The **ad creative itself is served by a mediation SDK — in the MVP, Google AdMob (`react-native-google-mobile-ads`)**, which is the network RevenueCat documents for this integration. So the authority split is:

- **The configured mediation provider (AdMob in the MVP) is the external source of the ad and the source of the ad revenue** — it runs the auction, renders the creative, and pays the developer directly (this revenue does not flow through Apple/Google IAP and is not subject to their IAP commission, because display ads are not in-app purchases). The `AdProvider` abstraction keeps the rest of the system independent of which network this is.
- **RevenueCat is the analytics system of record for ad revenue** — it receives the per-impression revenue BidClean reports and unifies it with subscription revenue; it never serves ads and never gates them.
- **The `ad_free` entitlement (owned by `revenuecat-subscriptions`) is the authority for WHETHER a user sees ads** — this module renders ads only when `ad_free` is absent; it never re-decides eligibility, and it never treats "PRO" (global or role-specific) as the ad gate.

This module owns **ad rendering, placement, the client-side consent flow for ad serving, and ad-revenue tracking on mobile only**. It does NOT own the `ad_free` entitlement or subscription tier (owned by `revenuecat-subscriptions`), the commission math (owned by `commission-system`), or any server-side logic — ad serving, consent, and tracking are entirely client-side. There is deliberately **no backend work** in this spec.

**Ad eligibility vs. render decision (deliberately layered).** `ad_free` remains the single *eligibility* authority, but eligibility alone does not force an ad to appear. An ad is rendered only when ALL of the following hold: `adsEnabled` (no active `ad_free`, from `revenuecat-subscriptions`) **AND** the ad provider is ready **AND** the placement is allowed (Cleaner radar list) **AND** consent state has been resolved to a personalization mode the provider may serve. Any missing condition yields "no ad shown" with a fully functional radar — never a broken slot.

**Attribution identity is privacy-scoped.** Ad revenue must attribute to the same user as subscriptions for unified LTV, but this does NOT mean BidClean's internal user UUID is handed to the ad network. The module uses a stable attribution identifier associable with the RevenueCat `app_user_id`, without exposing internal user identifiers to the ad network unless explicitly approved by the privacy architecture.

The module is built around an **abstract `AdProvider` seam** so the radar's `AdSlot` consumes ads through an interface rather than binding directly to AdMob. AdMob is the default concrete implementation; the seam keeps ad rendering testable without a live AdMob account (mocked exactly as the RevenueCat purchases SDK is mocked today) and lets a different mediation network be swapped in later without touching the radar.

## Domain Model Overview

```
AdMob (mediation network: runs auction, serves creative, PAYS the developer)
        │
        │  banner/native ad fill + impression-level revenue data (ILRD)
        ▼
AdProvider (abstract seam)  ──  AdMobAdProvider (concrete)  ──  MockAdProvider (tests)
        │
        │  onAdImpression(revenue, currency, network, ...)
        ├───────────────────────────────► RevenueCat AdTracker  ──►  RevenueCat Charts (unified LTV: subs + ads)
        │
        ▼
AdSlot (radar list, free-tier Cleaners)  ── rendered only WHEN ──►  adsEnabled AND providerReady
                                                                     AND placementAllowed AND consentResolved
        ▲                                                            (adsEnabled reads `ad_free` from the mirror)
        │  personalization input (never an eligibility gate)
CONSENT:  trackingAuthorizationStatus (iOS ATT)  +  consentStatus (UMP/GDPR)  ──►  personalizationMode
                                                                     (personalized vs non-personalized → affects eCPM, not eligibility)
```

- An **ad** is a creative (banner or native) served by the mediation provider (AdMob in the MVP) into an `AdSlot`. BidClean never hosts or chooses the creative.
- **Ad eligibility is decided elsewhere:** a user is *eligible* for ads iff `useAdVisibility()` reports `adsEnabled` (i.e. no active `ad_free`). Eligibility is necessary but not sufficient — the layered render decision (provider ready, placement allowed, consent resolved) also applies.
- **`ad_free` — not "PRO" — is the ad gate.** Because Host and Cleaner subscriptions are independent, "PRO" is role-specific (`cleaner_pro` / `host_pro`) and does not by itself suppress ads. Ads are suppressed only when the user's active context has an active `ad_free` entitlement. If the product ever wants any PRO to remove ads globally, that must be defined in `revenuecat-subscriptions` (by granting `ad_free`), not assumed here.
- **Ad revenue is earned by the provider and reported to RevenueCat:** each paid impression carries ILRD (revenue, currency, network, ad unit); the module forwards it to RevenueCat's `AdTracker`. RevenueCat aggregates; it is not the payer.
- **Consent is a personalization input, not an eligibility rule:** iOS App Tracking Transparency (`trackingAuthorizationStatus`) and GDPR/UMP (`consentStatus`) are distinct decisions on distinct platforms; the module derives a single `personalizationMode` (personalized vs non-personalized) from both. Consent affects eCPM, never whether a paying/`ad_free` user sees ads (they never do) nor whether an eligible free user is monetizable.
- **Ads are Cleaner-only today by navigation topology:** the radar list (the only ad surface) lives in the Cleaner navigator; the Host navigator has no radar. This module SHALL make that invariant explicit rather than incidental.
- **Attribution identity, not the raw internal UUID:** ad revenue attributes to the same *user* as subscriptions (associable with the RevenueCat `app_user_id`) for unified LTV, but the module SHALL NOT expose BidClean's internal user identifiers to the ad network unless the privacy architecture explicitly approves it.
- **The placement cadence is presentational, not monetization-critical:** the existing `AD_SLOT_FIRST_POSITION`/`AD_SLOT_INTERVAL` cadence (owned by `offer-radar`) is preserved; this module changes what fills the slot, not where slots appear.
- **Ad lifecycle is idempotent:** list re-render, slot unmount/remount, and app background/foreground transitions SHALL NOT create duplicate ad requests for the same visible slot nor double-count impressions.

## Glossary

| Term | Definition |
|------|-----------|
| Display ad | A banner or native ad creative rendered in-app and monetized per impression/click (not an in-app purchase) |
| Mediation network | The service that runs the ad auction, serves the creative, and pays the developer; **AdMob** here |
| AdMob | Google's mobile ad mediation network (`react-native-google-mobile-ads`); the default ad source and payer |
| AdProvider | The abstract seam through which `AdSlot` requests/renders ads, decoupled from any specific network |
| AdMobAdProvider | The concrete `AdProvider` backed by AdMob |
| MockAdProvider | A test `AdProvider` that renders a deterministic placeholder and emits synthetic impressions, used in unit tests |
| Ad unit id | The AdMob identifier for a specific ad placement (banner/native), per platform (iOS/Android) |
| Paid impression | A provider callback explicitly identified as an impression-level *revenue* event (carries ILRD); the monetizable event forwarded to RevenueCat |
| Impression | A rendered ad view; note not every impression carries revenue and "ad loaded" is not an impression |
| ILRD | Impression-Level Revenue Data — per-impression revenue, currency, and network reported by the provider |
| AdTracker | The RevenueCat SDK surface that records ad impressions/revenue for unified LTV (does not serve ads) |
| Ad revenue tracking | Reporting paid-impression events to RevenueCat so ad revenue appears alongside subscription revenue in Charts |
| Ad revenue event id | A client-generated unique identifier per paid impression, used to prevent duplicate submission |
| `ad_free` entitlement | The entitlement (owned by `revenuecat-subscriptions`) that, when active, suppresses ads |
| useAdVisibility | The existing radar hook returning `{ adsEnabled, isLoading }` from the subscription mirror's `ad_free` state |
| AdSlot | The radar list component that renders an ad placement (today a placeholder) |
| Attribution identity | A stable identifier associable with the RevenueCat `app_user_id` used to attribute ad revenue, without exposing internal user ids to the ad network unless privacy-approved |
| ATT / trackingAuthorizationStatus | iOS App Tracking Transparency status governing cross-app tracking; one input to personalization |
| UMP / consentStatus | Google's User Messaging Platform (GDPR/EEA) consent status; a distinct input to personalization |
| personalizationMode | The derived mode (personalized vs non-personalized) computed from `trackingAuthorizationStatus` and `consentStatus` together |
| Personalized ad | An ad targeted using tracking/consent-granted signals; higher eCPM |
| Non-personalized ad | An ad served without tracking signals (consent denied/unavailable); lower eCPM but still monetizable |
| eCPM | Effective cost per mille — revenue per thousand impressions; the practical yield metric |
| Ad request | A call to the mediation network to fill a slot with a creative |
| Fill / no-fill | Whether the network returned an ad (fill) or not (no-fill) for a request |
| AdRevenueTracker | The client component that receives provider paid-impression events and reports them to RevenueCat's `AdTracker`, kept separate from the `AdProvider` |
| Mobile_App | The React Native mobile application used by Hosts and Cleaners |
| Radar list | The Cleaner-facing scrollable offer list (`OfferListView`) where ad slots are interleaved |

## Requirements

### Requirement 1: Real Ad Rendering in the Radar

**User Story:** As the platform, I want free-tier Cleaners to see real ads in the radar list, so that users who do not pay for PRO/`ad_free` are monetized through advertising.

#### Acceptance Criteria

1. THE Mobile_App SHALL replace the `AdSlot` placeholder content with a real ad rendered through the `AdProvider` seam (a banner or native ad), preserving the existing container, the "Sponsored" label, the accessibility label, and the `testID="ad-slot"`.
2. THE `AdSlot` SHALL render an ad ONLY when the layered render decision holds: `adsEnabled` (from `useAdVisibility` — no active `ad_free`) AND the provider is ready AND the placement is allowed (Cleaner radar list) AND consent state is resolved to a personalization mode the provider may serve. IF any condition is unmet, THE slot SHALL render nothing and the list SHALL remain fully functional.
3. THE eligibility gate SHALL be the active `ad_free` entitlement (via `useAdVisibility`), NOT the PRO tier: a user without `ad_free` is eligible for ads even if PRO in some role, and a user with active `ad_free` is never shown ads. Any "PRO removes ads globally" behavior, if desired, SHALL be expressed in `revenuecat-subscriptions` by granting `ad_free`, and SHALL NOT be inferred in this module.
4. THE ad placement cadence SHALL preserve the existing behavior owned by `offer-radar`: the first ad slot at `AD_SLOT_FIRST_POSITION` and every `AD_SLOT_INTERVAL` thereafter, injected by `OfferListView`.
5. WHERE the mediation network returns no fill for a slot, THE `AdSlot` SHALL render nothing (or collapse) gracefully and SHALL NOT show a broken/empty ad frame or block the list.
6. THE ad rendering SHALL NOT degrade radar list scrolling, pagination, or pull-to-refresh, and SHALL not retain ad views after they scroll off (ads are released to avoid leaks).
7. THE ad surface SHALL remain limited to the Cleaner radar list in the MVP; THE module SHALL make the Cleaner-only invariant explicit (documented and, where practical, guarded) rather than relying solely on navigation topology.

### Requirement 2: Ad Provider Abstraction

**User Story:** As a developer, I want ad rendering behind an abstract provider, so that the radar is decoupled from any specific ad network and the feature is testable without a live ad account.

#### Acceptance Criteria

1. THE module SHALL define an `AdProvider` interface that exposes, at minimum, provider initialization taking an `AdProviderContext` (an object with optional consent/personalization, platform, environment, and attribution fields — not a bare `userId`), an ad-slot rendering surface (banner/native), and a paid-impression callback.
2. THE module SHALL provide a concrete `AdMobAdProvider` implementing `AdProvider` via `react-native-google-mobile-ads`, and a `MockAdProvider` for tests that renders a deterministic placeholder and can emit synthetic paid-impression events.
3. THE `AdSlot` and radar SHALL depend on the `AdProvider` interface only, never directly on AdMob APIs, so the network can be swapped without touching the radar.
4. THE selection of the concrete provider SHALL be configuration-driven and default to AdMob; in test environments the mock provider SHALL be used so no live network call occurs.
5. THE `AdProvider` SHALL never grant or revoke `ad_free`/PRO; it renders and reports only, and eligibility remains owned by `useAdVisibility`/the subscription mirror.
6. THE ad-revenue reporting to RevenueCat SHALL be performed by a separate `AdRevenueTracker` collaborator, not by the `AdSlot` component and not embedded in the `AdProvider` rendering path, so provider rendering and revenue tracking remain independently testable and swappable. THE `AdSlot` SHALL NOT call RevenueCat directly.

### Requirement 3: Ad Revenue Tracking to RevenueCat

**User Story:** As the platform, I want ad revenue reported to RevenueCat, so that each user's LTV reflects subscriptions and ads together in one place.

#### Acceptance Criteria

1. ONLY provider callbacks explicitly identified as impression-level *revenue* events (paid impressions carrying ILRD) SHALL be forwarded to RevenueCat's `AdTracker`; non-revenue callbacks (e.g. ad loaded, ad opened, or an impression without revenue) SHALL NOT be reported as revenue.
2. WHEN a paid impression is reported, THE `AdRevenueTracker` SHALL forward its ILRD (revenue amount, currency, network/ad-unit identifiers, timestamp) to RevenueCat, attributed to the attribution identity associable with the subscriptions `app_user_id` (see Requirement 5), so ad and subscription revenue unify per user.
3. THE ad revenue tracking SHALL be best-effort and non-blocking: a failure to report to RevenueCat SHALL never break ad rendering, the radar, or the user experience.
4. THE module SHALL report only ad-event metadata (revenue amount, currency, network/ad-unit identifiers, timestamps) and SHALL NOT send card data, tokens, or unnecessary PII to RevenueCat.
5. EACH paid impression SHALL carry a client-generated unique ad-revenue event id, and the `AdRevenueTracker` SHALL prevent duplicate submission of the same event id within its supported persistence window — so a retry, a component remount, or an app relaunch after a paid impression does not double-report it.
6. WHERE RevenueCat is not configured (e.g. missing key in a given environment), THE module SHALL skip tracking gracefully while still rendering ads.

### Requirement 4: Consent & App Tracking Transparency

**User Story:** As a user, I want to control ad tracking as the platforms require, so that my privacy choices are respected while the app remains compliant.

#### Acceptance Criteria

1. THE Mobile_App SHALL track two distinct consent inputs: `trackingAuthorizationStatus` (iOS App Tracking Transparency) and `consentStatus` (Google UMP / GDPR, where required by region); it SHALL NOT collapse them into a single boolean.
2. ON iOS, THE Mobile_App SHALL request ATT authorization at an appropriate time; ON regions requiring GDPR consent, it SHALL gather UMP consent. THE `personalizationMode` (personalized vs non-personalized) SHALL be DERIVED from both inputs together.
3. THE consent inputs SHALL determine `personalizationMode` only; they SHALL NOT determine ad ELIGIBILITY (a free-tier user with denied tracking is still eligible for non-personalized ads; an `ad_free` user is still shown no ads regardless of consent).
4. UNTIL the consent state is resolved, THE Mobile_App SHALL NOT request personalized ads. It MAY request non-personalized ads when permitted by the applicable platform/consent framework; otherwise it SHALL request no ad. (Non-personalized serving is not asserted as a universal guarantee — it is conditioned on platform/framework rules.)
5. THE module SHALL request ATT/consent at most as required and SHALL NOT re-prompt on every list render (the consent flow is resolved once per session/first-run per platform rules).

### Requirement 5: Ad SDK Configuration & Initialization

**User Story:** As a developer, I want the ad SDK configured with the same user identity as subscriptions, so that revenue attribution and gating are consistent.

#### Acceptance Criteria

1. THE Mobile_App SHALL initialize the ad provider using a stable, privacy-reviewed attribution identifier that CAN be associated with the authenticated RevenueCat `app_user_id`, WITHOUT exposing BidClean's internal user identifiers to the ad network unless explicitly approved by the privacy architecture. Ad revenue and subscription revenue SHALL therefore attribute to the same user without leaking internal ids.
2. THE ad provider SHALL initialize during application startup after the authenticated user identity is available, INDEPENDENTLY of the subscription module's initialization lifecycle, while reusing the same internal user identity for attribution. (Same identity, not the same lifecycle — the ad provider and the RevenueCat purchases SDK SHALL NOT be forced to share an initialization path.)
3. THE ad SDK SHALL be initialized at most once per session and SHALL be resilient to re-initialization attempts (idempotent).
4. WHERE the ad provider fails to initialize, THE radar SHALL continue to function (no ads shown) and SHALL NOT crash or block offers.

### Requirement 6: Ad Lifecycle Safety

**User Story:** As a user scrolling a live, virtualized radar list, I want ads to behave correctly as slots and the app come and go, so that the experience is smooth and revenue is counted correctly.

#### Acceptance Criteria

1. AD requests SHALL follow a provider-safe lifecycle and SHALL NOT repeatedly request a new ad for the same visible slot due solely to list re-rendering.
2. WHEN an ad slot scrolls out of and back into the viewport, THE module SHALL follow a defined, provider-safe policy (reuse or controlled reload) and SHALL NOT leak ad views or emit duplicate paid impressions.
3. THE ad lifecycle SHALL remain safe across `AdSlot` unmount/remount and across app background/foreground transitions: no duplicate active ad requests for the same visible slot, no duplicate impression reporting, and no broken slot after resume.
4. WHEN the radar screen is unmounted, THE module SHALL release any active ad views/resources for its slots.

### Requirement 7: Configuration and Defaults

**User Story:** As an operator, I want all ad behavior configurable via environment, so that nothing is hardcoded and no ad identifiers or keys are committed.

#### Acceptance Criteria

1. THE module SHALL read all ad identifiers and keys from configuration via `EXPO_PUBLIC_*` environment variables: per-platform AdMob application ids and per-platform ad unit ids (banner/native), never hardcoded in logic.
2. THE module SHALL derive its ad attribution identity from the same authenticated user as RevenueCat subscriptions (associable with the `app_user_id`) rather than introducing a divergent ad-user identity, subject to the privacy-scoping in Requirement 5 (no internal user id exposed to the ad network unless approved).
3. THE ad placement cadence constants (`AD_SLOT_FIRST_POSITION`, `AD_SLOT_INTERVAL`) SHALL remain the single source for placement; if made configurable they SHALL use `EXPO_PUBLIC_*`, otherwise remain the existing literals.
4. WHERE required ad configuration is absent in a given environment (e.g. no ad unit id), THE module SHALL disable ad rendering for that environment gracefully rather than crash, and SHALL use AdMob's official test ad unit ids in development so no real ads are served during testing.
5. THE module SHALL NOT ship or reference the mediation network's account secrets in the client; only the public application/ad-unit identifiers are used client-side.

### Requirement 8: Internationalization & Design

**User Story:** As a user in any supported locale, I want ad slots to fit the app's language and design, so that the experience is consistent.

#### Acceptance Criteria

1. THE `AdSlot` chrome (the "Sponsored" label, accessibility label, and any error/empty state) SHALL use i18n keys across the supported languages, reusing the existing `radar.adSlot.*` namespace (extended as needed).
2. THE `AdSlot` container SHALL follow the BidClean dark design system (card `#1F2833`, background `#0B0C10`, muted labels), consistent with the current placeholder, while the ad creative itself is controlled by the advertiser/network.
3. THE ad creative content SHALL NOT be translated or altered by BidClean (it is served by the network); only the surrounding chrome is localized.

## Non-Functional Requirements

### Correctness Properties

- **P1 — Eligibility authority is `ad_free`, not PRO:** A user is eligible for ads iff `useAdVisibility()` reports `adsEnabled` (no active `ad_free`). This module never re-decides eligibility, never treats PRO (global or role-specific) as the gate, and never shows ads to a user with active `ad_free`.
- **P2 — Provider abstraction:** The radar depends only on the `AdProvider` interface; swapping the concrete network requires no change to `AdSlot`/`OfferListView`.
- **P3 — Testability without a live network:** With the mock provider, ad slots render deterministically and paid impressions can be simulated, with zero real ad requests.
- **P4 — Non-blocking tracking:** A failure to report ad revenue to RevenueCat never breaks rendering, the radar, or the app.
- **P5 — No double counting:** Each paid impression, keyed by its client-generated event id, is reported to `AdTracker` at most once, even across retry/remount/relaunch within the persistence window.
- **P6 — Consent correctness:** `personalizationMode` is derived from `trackingAuthorizationStatus` (ATT) and `consentStatus` (UMP) together; personalized ads are requested only when both permit; until resolved, no personalized request is made; consent never gates eligibility.
- **P7 — Graceful no-fill:** A no-fill or provider error yields no visible broken ad and never blocks the list.
- **P8 — Configuration integrity:** No ad unit id, application id, or key is hardcoded; all come from `EXPO_PUBLIC_*` configuration, with test ad units in development.
- **P9 — Identity consistency without leakage:** Ad revenue attributes to the same user as subscriptions (associable with `app_user_id`) so LTV unifies per user, without exposing BidClean's internal user identifiers to the ad network unless privacy-approved.
- **P10 — No sensitive persistence/transmission:** Only ad-event metadata is reported; never card data, tokens, or unnecessary PII.
- **P11 — Cleaner-only surface:** In the MVP, ads render only in the Cleaner radar list; Hosts never see ads.
- **P12 — No IAP entanglement:** Ad revenue is not an in-app purchase; the module never routes ad revenue through the store IAP/purchase flow and never affects `SUBSCRIPTION_TIER`.
- **P13 — Slot lifecycle idempotency:** Re-rendering, unmounting, remounting, or backgrounding/foregrounding the radar SHALL NOT create duplicate active ad requests for the same visible slot.
- **P14 — Impression uniqueness:** A single provider paid-impression event maps to at most one RevenueCat ad-revenue event (one event id → one report).

### Security & Privacy
- Only public ad application/ad-unit identifiers are used client-side; mediation account secrets are never shipped or committed.
- ATT (iOS) and UMP/GDPR consent SHALL be requested per platform rules before personalized ads; denied consent yields non-personalized ads, not blocked monetization.
- Ad-event reporting to RevenueCat SHALL contain metadata only (revenue, currency, network/ad-unit ids, timestamps) — no PII.
- The app's privacy disclosures (App Store privacy label / data-safety) SHALL reflect ad tracking; this is a release-configuration responsibility surfaced by this spec, not code.

### Performance
- Ad requests and rendering SHALL not block the radar list; ads load asynchronously and collapse on no-fill.
- Ad views SHALL be released when scrolled off to avoid memory growth in long lists.
- Consent/ATT resolution SHALL happen once per session, not per render.

### Reliability
- Provider initialization, ad requests, and revenue reporting SHALL fail safe: any failure results in "no ad shown" and a functioning radar, never a crash or a blocked list.
- The feature SHALL be fully testable in CI with the mock provider (no live AdMob/RevenueCat calls), consistent with how the RevenueCat purchases SDK is mocked today.

### Internationalization
- All `AdSlot` chrome text SHALL use i18n keys across supported languages; the ad creative itself is network-served and not localized by BidClean.

## Dependencies

- **revenuecat-subscriptions (Spec 11):** owns the `ad_free` entitlement and the subscription mirror; supplies `useAdVisibility` (the ad eligibility authority) and the RevenueCat SDK configuration/`app_user_id` lifecycle this module attaches to. This module consumes that eligibility; it never re-decides it.
- **offer-radar (Spec 7):** owns the radar list (`OfferListView`), the `AdSlot` placement seam, and the `AD_SLOT_*` cadence constants; this module fills the slot with real ads.
- **user-authentication / user-roles (Specs 1, 2):** provide the internal user UUID (ad attribution identity) and the role topology that keeps ads Cleaner-only.
- **Google AdMob (`react-native-google-mobile-ads`):** the mediation network that serves ad creatives and pays ad revenue; the default `AdProvider` implementation. Requires an AdMob account and per-platform ad unit ids at release time (test ad units in development).
- **RevenueCat (`AdTracker`):** the analytics system of record for ad revenue (unified LTV); receives reported impressions. A RevenueCat MCP server is configured for catalog/analytics context from the IDE.
- **Expo / EAS:** AdMob is a native module requiring a config plugin and a prebuild/EAS build; unit tests run against the mock provider without a native build.

## Out of Scope

- The `ad_free` entitlement and subscription tier resolution (owned by `revenuecat-subscriptions`); this module only consumes ad eligibility.
- Rewarded ads and ad-granted rewards (virtual currency or timed entitlements) — a distinct RevenueCat feature that can be added as a later spec; this spec is display ads only.
- Any backend/server-side work — ad serving, rendering, consent, and revenue tracking are entirely client-side; the `ad_free` mirror already exists and needs no change.
- Choosing/hosting ad creatives, running the auction, or negotiating advertiser deals — owned by the mediation network (AdMob).
- Host-side ad placements and non-radar ad surfaces (e.g. map view, other screens) — out of MVP scope; the abstraction allows adding them later.
- Web ads / web funnels — a separate web concern.
- Creating/configuring the AdMob account, ad units, and the RevenueCat ad-tracking setup themselves (done in the AdMob and RevenueCat dashboards); this spec consumes them by configured identifier.
- Mediation networks other than AdMob (AppLovin MAX, ironSource, etc.) — the `AdProvider` seam permits them, but only AdMob is implemented in this spec.

# ADR-008: Client-Side Ads via an AdProvider Seam with RevenueCat Revenue Tracking

## Status
Accepted

## Context
BidClean monetizes the free tier with display ads: *"if you don't pay for a subscription, you see
advertising."* The ads must appear in the Cleaner radar list (never for Hosts), must disappear the
moment a user holds the `ad_free` entitlement (Spec 11), and their revenue must attribute to the
same user as subscriptions so lifetime value is unified.

A recurring source of confusion had to be settled first: **RevenueCat does not serve or render the
ad — AdMob does**, and AdMob pays the developer directly (display ads are not in-app purchases, so
the stores take no commission on them). RevenueCat's role here is purely **revenue tracking** for
LTV. Ads therefore need a real ad network SDK on the client plus a tracking hop to RevenueCat —
there is no backend, no database, and no server endpoint involved.

The open questions were: *what decides eligibility*, *how the ad network stays swappable and
testable without a native build*, *how ad revenue is tracked without leaking identity*, and *how
consent (ATT/UMP) interacts with all of the above*.

## Decision
We built a mobile-only, client-side `ads` feature module structured around an abstract
`AdProvider` seam. Seven consequential sub-decisions:

1. **`ad_free` is the single eligibility authority.** Eligibility is read only from
   `useAdVisibility` (the `ad_free` entitlement from Spec 11) — never from PRO/tier/role. If a
   product wants "PRO removes ads," it is expressed by granting `ad_free` in the subscriptions
   module, not by reading PRO here.
2. **Layered render decision.** An ad renders iff
   `adsEnabled AND providerReady AND placementAllowed AND consentResolved`. Any missing condition
   means no ad and a fully functional radar.
3. **Abstract `AdProvider` seam, config-driven factory.** The radar/`AdSlot`/`AdBanner` depend only
   on the `AdProvider` interface. `AdMobAdProvider` (real) and `MockAdProvider` (tests) are selected
   by a factory: test → mock, dev → AdMob with Google's official test unit ids, production with
   valid config → AdMob, production with missing config → **ads disabled (never a mock fallback)**.
4. **Revenue tracking is separate from rendering.** An `AdRevenueTracker` — not the provider, not
   the `AdSlot` — reports paid impressions (ILRD) to RevenueCat. The `AdSlot`/`AdBanner` never
   import RevenueCat; paid impressions flow out through a callback.
5. **Privacy-scoped attribution identity.** The ad/tracking identity is a stable, purpose-separated
   pseudonym derived from the internal `app_user_id` (a salted, `":ads"`-scoped SHA-256 digest),
   never the raw internal UUID. This is deliberate purpose separation, not anonymization.
6. **Best-effort, deduped, non-blocking tracking.** Only paid impressions are reported; each is
   keyed by a client-generated `eventId` and deduped via an in-memory + bounded persisted ring so a
   retry, remount, or relaunch never double-counts. Any tracking failure is swallowed — it never
   breaks rendering or the radar. This is duplicate *reduction*, not a remote exactly-once
   guarantee.
7. **Platform-aware consent shapes personalization, never eligibility.** `derivePersonalizationMode`
   reads iOS ATT + Google UMP as two distinct inputs (never collapsed); ATT is iOS-only, so an
   `unavailable` ATT on Android is not a denial. `UNRESOLVED` consent suppresses a *personalized*
   request, not the ad itself.

## Reasoning
- **One eligibility authority prevents drift.** Ads and the subscription experience must agree on
  "who is free." Reusing `ad_free` (not re-deriving from PRO) keeps a single source and makes
  "PRO removes ads" a subscriptions-side policy, not an ads-side assumption.
- **Swappable + CI-safe by construction.** The provider seam lets the whole UX render and be
  property-tested against `MockAdProvider` with zero real ad requests; the factory's
  never-mock-in-production rule ensures a misconfigured release simply shows no ads rather than
  fake ones.
- **Rendering and money are independently testable.** Separating the tracker from the provider/slot
  means a tracking outage cannot affect the radar, and the "no RevenueCat import in the view" rule
  is enforceable (and tested).
- **Unified LTV without identity leakage.** A purpose-separated pseudonym lets RevenueCat attribute
  ad revenue to the same user as subscriptions without ever handing the ad network BidClean's raw
  UUID.
- **Correct privacy semantics per platform.** Treating ATT and UMP separately, and never reading an
  Android `unavailable` ATT as a denial, avoids both over- and under-restricting personalization,
  and keeps consent from ever being mistaken for an eligibility gate.

## Lifecycle & Placement Model
- **Placement stays in offer-radar.** `OfferListView.injectAdSlots` and the `AD_SLOT_FIRST_POSITION`
  / `AD_SLOT_INTERVAL` cadence are unchanged; the ads module only *fills* the existing slot. Ads are
  Cleaner-only because only the Cleaner navigator mounts the radar list.
- **Request-once-per-mount / release-on-unmount by render topology.** A resolved slot mounts exactly
  one `AdBanner`, which mounts exactly one native ad view owned by `AdMobAdProvider`'s
  `AdMobBannerView` wrapper. A live list re-render does not remount it (no re-request); unmounting
  the slot unmounts and releases the native view (Req 6.4). No imperative lifecycle state is kept in
  the slot hook.
- **Operational kill-switch is not a security control.** `EXPO_PUBLIC_ADS_ENABLED` can disable ads
  operationally, but it is client-side and rebuildable; eligibility is always governed by `ad_free`.

## Alternatives Considered
- **Gate ads on the absence of PRO instead of `ad_free`.** Rejected: PRO is role-specific and a user
  could be PRO in one role and still free-tier for ads; conflating them would drift from the
  subscription experience. `ad_free` is the explicit, independent authority.
- **Call the AdMob SDK directly from the radar/`AdSlot`.** Rejected: couples the UI to one vendor,
  blocks CI/testing without a native build, and entangles rendering with revenue tracking.
- **Fall back to the mock provider when production config is missing.** Rejected: it would render
  fake ads in production; disabling ads (null provider) is the safe, honest behavior.
- **Send the raw internal `app_user_id` to the ad network for attribution.** Rejected: leaks a
  cross-context identifier; a purpose-separated pseudonym unifies LTV without the leak.
- **Report every "ad loaded" event, or guarantee remote exactly-once.** Rejected: only paid
  impressions carry revenue, and a remote exactly-once contract is neither offered nor needed —
  local best-effort dedup is sufficient and cannot block the UI.
- **Collapse ATT and UMP into a single boolean, or read ATT on Android.** Rejected: they are
  distinct signals on distinct platforms; collapsing them mis-derives personalization and risks
  treating an Android `unavailable` ATT as a denial.
- **Add a backend ads module / endpoint.** Rejected: display ads are served and paid entirely
  client-side by AdMob; the only server-side dependency (`ad_free`) already exists in Spec 11.

## Consequences
- The mobile app gains two native dependencies — `react-native-google-mobile-ads` (AdMob + UMP) and
  `expo-tracking-transparency` (iOS ATT) — both mocked in `src/__mocks__/setup.ts` so unit,
  property, and integration tests run without a prebuild/EAS build.
- Real ads require an AdMob account and per-platform application/ad-unit ids configured via
  `EXPO_PUBLIC_ADMOB_*`, plus an Expo config plugin / prebuild at build time; RevenueCat ad-revenue
  tracking is configured in the RevenueCat dashboard. These are dashboard/build-time concerns,
  out of scope for the code, and no secrets are shipped (only public application/ad-unit ids).
- Only public application/ad-unit ids live client-side; mediation account secrets are never
  committed or bundled. `EXPO_PUBLIC_ADS_ENABLED` is an operational flag, not a security control.
- No backend, database, or migration is introduced. The only cross-spec dependency is the existing
  `ad_free` entitlement and `useAdVisibility` from revenuecat-subscriptions.
- MVP surface is the Cleaner radar banner slot on iOS + Android; additional placements or formats
  can reuse the same seam without a design change.

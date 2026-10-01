# ADR-011: RevenueCat shared products with single per-plan pricing (test-store phase)

## Status

Accepted (with scheduled remediation before store launch)

## Context

BidClean's business model defines two PRO tiers with different prices per role:
Cleaner PRO at 4.99 USD/month and Host PRO at 9.99 USD/month. The mobile code
(`apps/mobile/src/screens/subscriptions/subscriptions.constants.ts`) expects one
offering per role (`cleaner_pro`, `host_pro`), each exposing Monthly / Yearly /
Lifetime packages.

At configuration time the RevenueCat project only has a **Test Store** app. Its
catalog has three shared products — `monthly`, `yearly`, `lifetime` — used by
both role offerings. A single store product carries a single price, so a shared
`monthly` product cannot be 4.99 for Cleaner and 9.99 for Host at the same time.

Real store prices are not defined in RevenueCat; they are defined in Google Play
Console / App Store Connect and imported. The only app configured now is the
sandbox Test Store, where prices are placeholders for demo/testing.

## Decision

For the test-store phase we keep **shared products with a single price per plan**
(Monthly / Yearly / Lifetime), used by both the `cleaner_pro` and `host_pro`
offerings. We do **not** split products per role yet. Both offerings therefore
present the same price for the equivalent plan during sandbox/demo.

The two role offerings, their packages, and the entitlement mapping (each plan
unlocks the role PRO entitlement plus `ad_free`) are configured now so the app's
expected structure exists and the paywalls render.

## Consequences

- **Positive:** no duplicate products to maintain in the sandbox; the structure
  matches the mobile code; paywalls and purchase flow work end-to-end in test
  mode; nothing is thrown away when real store products are created.
- **Negative / debt:** during sandbox/demo both roles show the same per-plan
  price, so the 4.99 vs 9.99 differentiation is not represented yet. Paywall
  editor price labels are sample values, not the product's real price.

## Scheduled remediation (before store launch — clean-up owed)

When the real Google Play Store / App Store app configuration is added
(pre-launch), split the products per role so each role's price is correct:

- `cleaner_monthly` (4.99) / `cleaner_yearly` / `cleaner_lifetime`
- `host_monthly` (9.99) / `host_yearly` / `host_lifetime`

Re-attach the per-role products to the corresponding offering packages and to
the role PRO + `ad_free` entitlements, then remove the shared placeholder
products. This is the "leave it clean" step deferred from the test-store phase.
Tracked as technical debt in `docs/CHANGELOG.md`.

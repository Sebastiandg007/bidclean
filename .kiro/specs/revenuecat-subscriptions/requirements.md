# Requirements Document

## Introduction

The revenuecat-subscriptions module is the **source of truth for a user's subscription tier** (FREE vs PRO) across BidClean. It integrates RevenueCat as the in-app-purchase (IAP) layer for two subscription products — **Cleaner PRO** and **Host PRO** — and turns RevenueCat's entitlement state into an authoritative, server-side answer to the question *"is this user PRO right now?"* that the rest of the platform already depends on.

Today that question is answered by a stub: `commission-system` owns a `SUBSCRIPTION_TIER` contract (`getTier(userId) → FREE | PRO`) whose default implementation returns FREE for everyone, and the mobile radar has an `ad_free` entitlement abstraction (`useAdVisibility`) that is a placeholder because the RevenueCat SDK is not installed. This spec replaces both stubs with the real implementation: the backend becomes the authoritative tier resolver (fed by RevenueCat webhooks + a durable local mirror), and the mobile app gains the RevenueCat SDK, a subscription store, and server-driven paywalls.

The module keeps a **durable local mirror** of each user's entitlements (`cleaner_pro`, `host_pro`, `ad_free`) so that tier resolution is fast and resilient: RevenueCat webhooks keep the mirror current, and the mirror is the last-known-trusted-tier cache that `commission-system`'s bounded lookup degrades to.

The authority split is deliberate and precise, to avoid any apparent contradiction:

- **RevenueCat is the source of truth for subscription/purchase state** — what a user bought, when it renews or expires, and which entitlements they hold. It is the system of record.
- **The BidClean subscription mirror is the authoritative runtime read model for BidClean's own authorization and business decisions** — tier resolution, commission gating, feature/ad gates. It is a read-optimized, reconcilable projection of RevenueCat truth, never an independent grantor of entitlements.

The mirror never invents access; it only reflects RevenueCat, reconciled continuously via webhooks and a periodic backstop sweep.

This module owns **subscription state and tier resolution only**. It does NOT own the commission math or the PRO commission discount (owned by `commission-system`, which already supports PRO-scoped rules and consumes tier via the `SUBSCRIPTION_TIER` contract), the alert-priority delivery ordering (owned by `offer-publishing`/`offer-radar`), the ad rendering/serving (owned by the future `revenuecat-ads`, Spec 12), or the web corporate funnels (web + Stripe, out of scope here).

## Domain Model Overview

```
RevenueCat (system of record: purchases, renewals, entitlements)
        │
        │  webhook events (INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, ...)
        ▼
SUBSCRIPTION WEBHOOK  ── verify auth header → dedup by event id → sanitize → BullMQ ──┐
        │                                                                              │
        │  async processing                                                            │
        ▼                                                                              │
SUBSCRIPTION (durable local mirror, one row per user)                                  │
   entitlements: { cleaner_pro?, host_pro?, ad_free? } with expiration + store         │
   last_synced_at, last_event_at                                                       │
        │                                                                              │
        ├── getTier(userId) ── active cleaner_pro OR host_pro ⇒ PRO, else FREE ────────┘  (SUBSCRIPTION_TIER contract)
        │
        ├── GET /subscriptions/me ── active entitlements for the mobile UI gates
        │
        ▼
CONSUMERS: commission-system (PRO commission rules), radar ad gate (ad_free), PRO badge/features
```

- A **Subscription** is a durable per-user mirror of RevenueCat entitlement state. It is not the system of record — RevenueCat is — but it is the authoritative *runtime read model* the platform queries for authorization/business decisions.
- **Two distinct concepts, deliberately separated:**
  - **Global subscription tier** (`FREE | PRO`) — what the `SUBSCRIPTION_TIER` contract (`getTier(userId)`) returns; a user is PRO when they hold an active `cleaner_pro` OR `host_pro` entitlement.
  - **Role-specific entitlement** (`cleaner_pro`, `host_pro`) — what the UI and role-scoped features query per role. Because BidClean's Host and Cleaner views are fully independent, a user can be PRO in one role and FREE in the other (e.g. active `cleaner_pro`, expired `host_pro`): globally they resolve PRO, but the Host view shows FREE benefits and the Cleaner view shows PRO. Commission-system already resolves per side, so the Host fee uses the Host tier and the Cleaner commission uses the Cleaner tier.
- **Tier is derived, not a stored flag:** resolved at query time from active entitlements (expiration always evaluated), so a user who cancelled/expired is never stale-PRO.
- **`ad_free` is an independent entitlement and does NOT imply PRO.** `getTier` considers only `cleaner_pro`/`host_pro`; `ad_free` gates ads only. (In practice PRO products may also grant `ad_free`, but that is a RevenueCat product configuration, not a tier-derivation rule here.)
- **The purchase → webhook → mirror window is explicit.** Between a successful purchase and the webhook updating the mirror, the mobile client MAY optimistically show the new entitlement for UI, but server-authorized PRO access becomes effective only once the mirror is updated. The client refreshes `/subscriptions/me` after purchase to converge.
- **Webhooks keep the mirror current;** a periodic reconciliation sweep is the backstop (webhooks can be delayed, dropped, or delivered out of order).
- **The mobile SDK is a client convenience, not the authority.** The app reads `customerInfo` for instant UI gating, but the backend mirror is authoritative for anything that affects money or access. The client never grants itself entitlements.
- **`app_user_id` is the internal user UUID.** RevenueCat is keyed by the same internal user id already used by the account-deletion cascade, so the mirror joins cleanly to `users`.
- **One mirror row per user is sufficient for v1** (`cleaner_pro`/`host_pro`/`ad_free` with expiration + store); the append-only event ledger holds the full history (upgrades, product changes, store migrations, transfers, billing issues). Multi-row per-subscription modeling is intentionally deferred unless a future need arises.

## Glossary

| Term | Definition |
|------|-----------|
| Global subscription tier | The `FREE \| PRO` value returned by `getTier(userId)`; PRO iff an active `cleaner_pro` or `host_pro` entitlement exists |
| Role-specific entitlement | A per-role access grant (`cleaner_pro`, `host_pro`) queried by the UI and role-scoped features; a user may hold one and not the other |
| Entitlement | A RevenueCat access grant unlocked by a product; the platform uses `cleaner_pro`, `host_pro`, `ad_free`. `ad_free` is independent and does not imply PRO |
| Source of truth | RevenueCat — authoritative for subscription/purchase/entitlement state |
| Runtime read model | The BidClean subscription mirror — authoritative for BidClean's own authorization/business decisions, reconciled to RevenueCat |
| Purchase→mirror window | The brief interval between a completed purchase and the webhook updating the mirror, during which the client may optimistically reflect the entitlement for UI only |
| Cleaner PRO | The Cleaner subscription product ($4.99/mo, $39.99/yr) granting the `cleaner_pro` entitlement |
| Host PRO | The Host subscription product ($9.99/mo, $79.99/yr) granting the `host_pro` entitlement |
| Subscription mirror | The durable local per-user projection of RevenueCat entitlement state (the `subscriptions` table) |
| System of record | RevenueCat — the authoritative owner of purchase/renewal/entitlement truth |
| app_user_id | The RevenueCat subscriber identifier; equals the internal user UUID |
| customerInfo | The RevenueCat SDK object describing a user's active entitlements on the device |
| Offering | A RevenueCat-configured set of packages (products) presented on a paywall |
| Paywall | A RevenueCat server-driven (Paywalls V2) purchase screen for a subscription product |
| SUBSCRIPTION_TIER contract | The existing DI token (`getTier(userId) → FREE\|PRO`) that this module implements for real |
| Last-known trusted tier | The most recent successfully-synced tier for a user, served from the mirror when a fresh lookup is unavailable |
| Subscription webhook | RevenueCat's server-to-server event notification consumed by this module |
| Subscription event ledger | The append-only sanitized record of processed RevenueCat webhook events |
| Store | The purchase source of an entitlement (`app_store`, `play_store`, `amazon`, `stripe`, `promotional`) |
| Grace period / billing issue | A state where an entitlement is retained temporarily despite a failed renewal, per RevenueCat |
| Mobile_App | The React Native mobile application used by Hosts and Cleaners |

## Requirements

### Requirement 1: Authoritative Subscription Tier Resolution

**User Story:** As the platform, I want an authoritative server-side answer to whether a user is PRO, so that commission discounts, feature gates, and badges are correct and cannot be spoofed by the client.

#### Acceptance Criteria

1. THE module SHALL implement the existing `SUBSCRIPTION_TIER` contract (`getTier(userId): Promise<FREE | PRO>`), replacing the default stub, using the durable subscription mirror as its source.
2. WHEN resolving a user's GLOBAL tier, THE module SHALL return PRO if the user holds an active `cleaner_pro` OR `host_pro` entitlement at resolution time, and FREE otherwise.
3. THE module SHALL treat an entitlement as active only when its expiration is in the future (or open-ended), including RevenueCat grace-period/billing-issue retention where RevenueCat still reports it active.
4. THE tier resolution SHALL be a fast, bounded read from the local mirror and SHALL NOT make a synchronous call to RevenueCat on the hot path.
5. IF no subscription mirror row exists for a user, THEN THE module SHALL resolve FREE (never fail), consistent with the current backward-compatible behavior.
6. THE module SHALL preserve the safe-degradation contract already relied upon by `commission-system`: the mirror serves as the last-known trusted tier, so a transient RevenueCat outage never changes a resolved tier and never blocks offer creation or match.
7. THE module SHALL expose a ROLE-AWARE resolution `getRoleTier(userId, role)` alongside `getTier`, extending the `SUBSCRIPTION_TIER` contract: the Host tier SHALL derive from `host_pro` only and the Cleaner tier from `cleaner_pro` only, so a user who is PRO in one role and FREE in the other resolves correctly per role. `commission-system` SHALL resolve the Host fee against the Host tier and the Cleaner commission against the Cleaner tier. `getTier` (global) SHALL remain for backward compatibility.
8. THE `ad_free` entitlement SHALL NOT imply the PRO tier: tier resolution SHALL consider only `cleaner_pro`/`host_pro`, and a user holding `ad_free` alone SHALL resolve FREE for both roles and globally.

### Requirement 2: RevenueCat Webhook Ingestion

**User Story:** As the platform, I want to receive and durably record RevenueCat subscription events, so that the local mirror stays current without polling.

#### Acceptance Criteria

1. THE module SHALL expose a public webhook endpoint (not behind the JWT guard) that RevenueCat calls with subscription events.
2. THE webhook SHALL authenticate every request before any processing, preferring an HMAC-SHA256 signature over the raw body with a timestamp-tolerance replay guard and constant-time comparison, and falling back to a configured shared-secret authorization header only when HMAC is unavailable; unauthenticated requests SHALL be rejected without mutation.
3. THE webhook SHALL deduplicate by RevenueCat event id: a redelivered event SHALL be acknowledged without reprocessing.
4. THE webhook SHALL persist a sanitized event into an append-only ledger (ids, event type, product/entitlement identifiers, store, timestamps, expiration) and SHALL NOT store card data, tokens, or unnecessary PII.
5. THE webhook SHALL commit the ledger record (marked as received/undispatched) BEFORE acknowledging, THEN enqueue asynchronous processing (BullMQ) and return a fast success acknowledgment; an acknowledged webhook SHALL remain recoverable until successfully processed (a recovery worker re-enqueues received-but-unprocessed records), so an acknowledged event is never lost even if enqueue fails.
6. THE module SHALL handle at least these event types by updating the mirror accordingly: `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `SUBSCRIPTION_PAUSED`, `TRANSFER`; unknown/unhandled event types SHALL be recorded in the ledger without mutating the mirror, with reconciliation remaining authoritative.
7. WHERE events arrive out of order, THE module SHALL converge each entitlement to its latest authoritative state using PER-ENTITLEMENT event timestamps: a stale event SHALL NOT overwrite a newer state for its entitlement, and an event for one entitlement SHALL NOT suppress a newer/valid event for a different entitlement.
8. THE webhook processing SHALL be idempotent: reprocessing the same event id or replaying events SHALL never produce an incorrect mirror state.
9. ON a `TRANSFER` event, WHERE the payload identifies both the source and destination subscribers, THE module SHALL update BOTH mirror rows in a single transaction — removing/downgrading the transferred entitlement from the source user and applying it to the destination user — so a transferred entitlement never remains on the previous owner and is never lost by a partial write.
10. THE mapping from event type to entitlement state SHALL NOT force an entitlement inactive purely on an ambiguous event: `SUBSCRIPTION_PAUSED` and `BILLING_ISSUE` SHALL retain the entitlement active until its expiry when RevenueCat still grants access, and reconciliation SHALL be the final arbiter.

### Requirement 3: Durable Subscription Mirror

**User Story:** As the platform, I want a durable local mirror of each user's entitlements, so that tier resolution is fast, reconcilable, and resilient to RevenueCat downtime.

#### Acceptance Criteria

1. THE module SHALL persist a per-user subscription mirror capturing active entitlements (`cleaner_pro`, `host_pro`, `ad_free`), each with its expiration and originating store.
2. THE mirror SHALL record `last_synced_at` and the latest processed event timestamp so staleness and ordering can be reasoned about.
3. THE mirror row SHALL key on the internal user UUID (the RevenueCat `app_user_id`), joining cleanly to `users`.
4. THE module SHALL store entitlement expiration as timezone-aware timestamps and money-independent metadata only (no prices, no payment instruments).
5. THE subscription mirror migration SHALL be reversible (`up`/`down`) and SHALL use the next sequential migration timestamp after the existing commission migrations.
6. THE mirror SHALL be the durable source consulted by `getTier`; RevenueCat remains the system of record and the mirror is reconciled to it.

### Requirement 4: Reconciliation Backstop

**User Story:** As the platform, I want the mirror to self-heal against RevenueCat, so that a missed or dropped webhook does not leave a user with the wrong tier indefinitely.

#### Acceptance Criteria

1. THE module SHALL run a periodic reconciliation sweep that refreshes mirror rows against RevenueCat's authoritative subscriber state.
2. THE reconciliation SHALL prioritize rows most likely to be stale or impactful (e.g. near-expiration, recently-active, or not synced within a configurable window).
3. THE reconciliation SHALL converge the mirror to RevenueCat truth without distributed transactions, and SHALL be idempotent (a row already correct is a no-op).
4. THE reconciliation interval and staleness window SHALL be configurable via environment variables.
5. WHERE RevenueCat is unreachable during a sweep, THE module SHALL log and retry on the next interval without corrupting existing mirror state.
6. THE reconciliation SHALL be able to CREATE missing mirror rows for known RevenueCat subscribers — not only refresh existing rows — drawing candidates from recently-active users (and users known to have subscription events), so a new subscriber whose webhook was missed is eventually discovered and mirrored.
7. WHEN a client calls `GET /subscriptions/me` and the mirror row is missing or older than the staleness window, THE module SHALL return the current (FREE/last-known) view immediately AND enqueue an asynchronous reconciliation for that user, WITHOUT making a synchronous RevenueCat call on the request path (self-healing that respects the performance budget).

### Requirement 5: Mobile Subscription SDK & Store

**User Story:** As a Host or Cleaner, I want the app to know my subscription status instantly and let me manage it, so that PRO features and gates reflect my entitlements.

#### Acceptance Criteria

1. THE Mobile_App SHALL integrate the RevenueCat SDK (`react-native-purchases`) and the Paywalls UI package (`react-native-purchases-ui`), configured with the internal user UUID as the `app_user_id`, using platform-specific public SDK keys from configuration. THE MVP platform matrix is iOS (App Store) and Android (Play Store); Amazon Appstore is out of MVP scope.
2. THE Mobile_App SHALL expose a subscription store (Zustand) that reads `customerInfo`, derives active entitlements, and updates reactively on purchase, restore, and SDK entitlement changes.
3. THE Mobile_App SHALL support restore purchases so a user can recover entitlements on a new device.
4. THE Mobile_App SHALL treat the client entitlement state as a UI convenience only; anything affecting money or access SHALL be governed by the backend mirror.
5. THE Mobile_App SHALL wire the existing `ad_free` gate (`useAdVisibility`) and the PRO badge/feature gates to the real entitlement state instead of the current placeholder.
6. THE Mobile_App SHALL never grant an entitlement locally; entitlements come only from RevenueCat/`customerInfo` and the backend mirror.

### Requirement 6: Paywalls & Purchase Flow

**User Story:** As a free-tier user, I want a clear paywall to upgrade to PRO, so that I can unlock PRO benefits.

#### Acceptance Criteria

1. THE Mobile_App SHALL present RevenueCat server-driven paywalls (Paywalls V2, via `react-native-purchases-ui`) for the Cleaner PRO and Host PRO offerings, so pricing and layout are configurable and A/B-testable without an app release.
2. THE paywall SHALL show the role-appropriate offering (Cleaner PRO for Cleaners, Host PRO for Hosts) resolved from the active role.
3. WHEN a purchase completes, THE Mobile_App MAY optimistically reflect the new entitlement in the store for UI purposes, but SHALL rely on the backend webhook to update the authoritative mirror; server-authorized PRO access becomes effective only once the mirror is updated.
4. WHEN a purchase completes or updated `customerInfo` is received, THE Mobile_App SHALL refresh `GET /subscriptions/me` so the client converges to the server-authoritative state (resolving the purchase→mirror window deterministically).
5. THE purchase and restore flows SHALL handle user cancellation, pending purchases, and errors gracefully with i18n messaging, and SHALL never leave the UI in an inconsistent entitlement state.
6. THE subscription product identifiers, entitlement identifiers, and offering identifiers SHALL come from configuration/RevenueCat, never hardcoded in UI logic.

### Requirement 7: Client-Facing Subscription Status

**User Story:** As the Mobile_App, I want a backend endpoint that reports the authoritative entitlement state, so that gates that must not be spoofed can rely on the server.

#### Acceptance Criteria

1. THE module SHALL expose an authenticated endpoint (`GET /subscriptions/me`) returning the caller's active entitlements and tier from the mirror.
2. THE endpoint SHALL return only entitlement metadata (identifiers, active flag, expiration, store) and SHALL NOT expose prices, payment instruments, or another user's data.
3. THE endpoint response SHALL reflect the mirror (webhook-fed) state, so it is consistent with `getTier` and with commission decisions.
4. THE endpoint SHALL resolve the caller from the JWT (keycloakId → internal user id) and SHALL scope results to that user only.

### Requirement 8: Account Lifecycle Integration

**User Story:** As a user deleting my account, I want my subscription state handled correctly, so that deletion is complete and consistent.

#### Acceptance Criteria

1. THE module SHALL keep the existing account-deletion RevenueCat cancellation behavior working (the deletion cascade already calls RevenueCat), and SHALL remove or anonymize the local subscription mirror row as part of deletion.
2. WHERE a user has no RevenueCat subscriber record, deletion SHALL proceed gracefully (no error), consistent with current behavior.
3. THE module SHALL NOT block account deletion on RevenueCat availability; mirror cleanup SHALL be idempotent and safe to retry.

### Requirement 9: Configuration and Defaults

**User Story:** As an operator, I want all RevenueCat behavior configurable via environment, so that nothing is hardcoded and keys are never committed.

#### Acceptance Criteria

1. THE module SHALL read all RevenueCat credentials and identifiers from environment/configuration: server secret API key, webhook signing secret (HMAC, preferred) and/or authorization secret, and (mobile) platform public SDK keys.
2. THE module SHALL reuse the existing `REVENUECAT_API_KEY` / `REVENUECAT_API_URL` variables already used by the account-deletion cascade rather than introducing divergent ones for the same purpose.
3. THE module SHALL validate required subscription configuration at startup (fail-fast) in non-test environments, consistent with existing modules; validation SHALL require a webhook secret (signing or bearer) and a non-empty RevenueCat entitlement id for every logical entitlement key.
4. THE module SHALL NOT hardcode product/entitlement/offering identifiers, prices, intervals, or secrets in logic. Internal logical entitlement keys (e.g. `CLEANER_PRO`) SHALL be mapped to configured RevenueCat identifiers; there SHALL be NO silent hardcoded fallback identifier in production (a missing mapping fails startup).
5. THE reconciliation intervals, staleness window, dispatch-recovery grace, and webhook retry/backoff SHALL be configurable via environment variables.

## Non-Functional Requirements

### Correctness Properties

- **P1 — Tier derivation correctness:** A user resolves PRO iff an active `cleaner_pro` or `host_pro` entitlement exists at query time; expiration is always respected.
- **P2 — Backward-compatible default:** With no mirror row (or an empty mirror), tier resolution returns FREE, reproducing the current stub behavior.
- **P3 — Webhook authenticity:** An event with a missing/invalid authorization secret is rejected with no mutation.
- **P4 — Idempotent ingestion:** Reprocessing the same event id, or replaying events, never produces an incorrect mirror state.
- **P5 — Out-of-order convergence:** A stale event never overwrites a newer entitlement state; the mirror converges to the latest authoritative state by timestamp.
- **P6 — Reconciliation convergence:** After any missed/dropped webhook, the periodic sweep converges the mirror to RevenueCat truth; a correct row is a no-op.
- **P7 — Server authority:** The client entitlement state never grants access on its own; money/access decisions read the backend mirror.
- **P8 — Safe degradation:** A RevenueCat outage never changes a resolved tier and never blocks offer creation, match, or account deletion (the mirror is the last-known trusted tier).
- **P9 — No sensitive persistence:** The ledger and mirror store entitlement metadata only — never card data, payment instruments, tokens, or unnecessary PII.
- **P10 — Configuration integrity:** No product/entitlement/offering id, price, interval, or secret is hardcoded; all come from configuration or RevenueCat.
- **P11 — Role-tier independence:** `cleaner_pro` and `host_pro` are resolved independently; a user can be PRO in one role and FREE in the other, and each role view reflects only its own entitlement.
- **P12 — `ad_free` non-implication:** Holding `ad_free` alone never resolves PRO; `getTier` derives tier solely from `cleaner_pro`/`host_pro`.
- **P13 — Transfer integrity:** After a `TRANSFER` identifying both users, the entitlement exists on exactly the destination mirror and no longer on the source mirror (atomic).
- **P14 — Purchase-window determinism:** Server-authorized PRO becomes effective only after the mirror is updated; the client optimistic view is UI-only and converges via a `/subscriptions/me` refresh.
- **P15 — Per-entitlement ordering:** An event for entitlement A never invalidates or suppresses a newer/valid event for entitlement B; ordering is tracked per entitlement.
- **P16 — Webhook durability:** Once a webhook is acknowledged, its ledger record remains recoverable until successfully processed (received-but-unprocessed records are re-enqueued).
- **P17 — Role-specific tier:** `cleaner_pro` affects the Cleaner tier only; `host_pro` affects the Host tier only.
- **P18 — Reconciliation discovers missing subscribers:** Reconciliation can create missing mirror rows for known RevenueCat subscribers / recently-active users, not only refresh existing rows.

### Security
- The webhook endpoint SHALL be authenticated by an HMAC-SHA256 signature (with timestamp tolerance + constant-time comparison), or a shared secret when HMAC is unavailable, and SHALL be safe to expose publicly (no JWT).
- Server secret API keys SHALL never be shipped in the mobile app; only public SDK keys are used client-side.
- Secrets SHALL never be committed to the repository; configuration references keys by name only.
- `GET /subscriptions/me` SHALL be JWT-authenticated and strictly scoped to the caller.
- The subscription ledger payload SHALL be sanitized (P9).

### Performance
- `getTier` SHALL resolve from the mirror within the existing bounded budget relied upon by `commission-system` (the commission provider already bounds the lookup with a timeout and FREE fallback); the mirror read SHALL be indexed by user id.
- Webhook handling SHALL return a fast acknowledgment and defer mirror updates to async processing.

### Reliability
- Webhook processing and reconciliation SHALL be idempotent and retry-safe (BullMQ with configurable backoff; dead-letter on exhaustion, no event silently lost).
- A RevenueCat outage SHALL degrade gracefully to the last-known mirror state; it SHALL never corrupt the mirror or block dependent flows.

### Internationalization
- All user-facing paywall/purchase/restore/error text in the Mobile_App SHALL use i18n keys (namespace per feature) across the supported languages; RevenueCat-provided paywall copy is configured per locale in RevenueCat.
- Subscription prices are presented by RevenueCat/the store in the user's local currency; the module never formats or hardcodes prices.

## Dependencies

- **commission-system (Spec 10):** owns the `SUBSCRIPTION_TIER` contract and PRO-scoped commission rules; this module provides the real implementation of that contract. Per the chosen wiring, `commission-system` consumes the real `SUBSCRIPTION_TIER` from this module (the default stub is retired).
- **user-authentication / user-roles (Specs 1, 2):** provide the internal user UUID (RevenueCat `app_user_id`), `keycloakId`, and the active role used to select the role-appropriate paywall.
- **user-profile (Spec 4):** the account-deletion cascade already cancels RevenueCat subscriptions; this module extends it to clean up the mirror.
- **offer-radar (Spec 7):** consumes the `ad_free` entitlement via `useAdVisibility`; this module supplies the real entitlement state.
- **RevenueCat:** system of record for purchases/renewals/entitlements; source of webhooks and the reconciliation authority. A RevenueCat MCP server is configured for catalog management from the IDE.
- **Redis / BullMQ (existing):** async webhook processing and reconciliation scheduling.

## Out of Scope

- The commission math and the PRO commission discount (owned by `commission-system`; this module only supplies the tier).
- Ad rendering/serving and ad placement logic (owned by `revenuecat-ads`, Spec 12); this module only supplies the `ad_free` entitlement state.
- Alert-priority delivery ordering (the "PRO gets alerts 30s earlier" behavior lives in `offer-publishing`/`offer-radar`); this module exposes the tier, it does not reorder deliveries.
- Web corporate funnels (RevenueCat Funnels + Stripe on web) — a separate web concern.
- Creating/configuring the RevenueCat products, entitlements, offerings, and paywalls themselves (done in the RevenueCat dashboard / via MCP); this spec consumes them by configured identifier.
- Being the system of record for purchases — RevenueCat is; this module maintains a reconcilable mirror only.

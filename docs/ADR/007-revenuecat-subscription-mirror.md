# ADR-007: RevenueCat Subscriptions as a Durable Local Mirror

## Status
Accepted

## Context
BidClean sells two auto-renewing subscriptions — **Cleaner PRO** and **Host PRO** — through
RevenueCat, and the platform must answer one question everywhere: *is this user PRO right now?*
That answer gates the commission discount (Spec 10), the ad-free experience, and PRO badges/
features. Until now it was a stub: `commission-system` owned a `SUBSCRIPTION_TIER` contract whose
default implementation returned FREE for everyone, and the mobile radar's `ad_free` gate was a
placeholder because the RevenueCat SDK was not installed.

RevenueCat is the system of record for purchases/renewals/entitlements, but querying it
synchronously on every tier lookup would couple money/access decisions to a third party's uptime
and latency — unacceptable on the hot paths of offer creation and match. The open questions were
*where the authoritative runtime answer lives*, *how it stays consistent with RevenueCat*, and
*how the two-role PRO semantics are expressed*.

## Decision
We introduced a dedicated `subscriptions` module that maintains a **durable, reconcilable local
mirror** of each user's entitlements and implements the real `SUBSCRIPTION_TIER` contract from it.
Five consequential sub-decisions:

1. **Authority split.** RevenueCat = source of truth for purchase/entitlement state; the local
   mirror = authoritative *runtime read model* for BidClean's own authorization/business
   decisions. The mirror never grants access on its own — it only reflects RevenueCat, reconciled
   continuously.
2. **Tier is derived, never stored.** A role is PRO iff that role's entitlement is active with a
   future/open-ended expiry at query time. `ad_free` never implies PRO.
3. **Role-aware resolution.** The contract is extended with `getRoleTier(userId, role)`: the Host
   fee resolves against `host_pro` only and the Cleaner commission against `cleaner_pro` only, so a
   user can be PRO in one role and FREE in the other. `getTier` (global) remains for compatibility.
4. **Durable webhook delivery (outbox + recovery).** A webhook is acknowledged only after its
   ledger row is committed as `RECEIVED`; a recovery worker re-enqueues any `RECEIVED`/`QUEUED` row
   that was never processed. An acknowledged event is never lost.
5. **One-directional wiring (A).** `SubscriptionsModule` provides and exports `SUBSCRIPTION_TIER`;
   `CommissionModule` imports it and drops the stub. `SubscriptionsModule` imports only the
   contract token from commission — no module cycle.

## Reasoning
- **Fail into last-known, never into an error.** Tier resolution is a bounded, indexed mirror read;
  a RevenueCat outage degrades to the last-known state and never blocks offer creation, match, or
  account deletion.
- **Correct two-role semantics.** Host and Cleaner views are independent, so a single global flag
  cannot express "PRO as a Host, FREE as a Cleaner." Per-role derivation makes the commission
  discount and the badges correct per side.
- **No lost money-affecting events.** Committing the ledger row before the ACK plus a recovery
  sweep closes the "acknowledged but never queued" gap that a naive enqueue-then-ACK leaves open.
- **Out-of-order resilience per entitlement.** Each entitlement carries its own `last_event_at`, so
  a late-but-valid event for one entitlement is never discarded because a newer event arrived for a
  different one.
- **No hardcoded identifiers.** Internal logical keys (`CLEANER_PRO`) map to configured RevenueCat
  ids; production startup fails fast if any mapping is missing.

## Data & Reconciliation Model
- `subscriptions` (mirror): one row per user, a per-entitlement snapshot
  (`_active`/`_expires_at`/`_store`/`_last_event_at`) with an `ON DELETE CASCADE` FK to `users`.
  Runtime authorization evaluates `active AND (expires_at IS NULL OR expires_at > now)`.
- `subscription_events` (append-only ledger + outbox): every sanitized webhook with a
  `dispatch_status` lifecycle (`RECEIVED` → `QUEUED` → `PROCESSED` / `FAILED`) and
  `uq_subscription_event_rc_id` for dedup. **No FK to `users`** so audit history survives deletion
  (the `user_id` is anonymized to NULL instead).
- Webhooks keep the mirror current; a periodic reconciliation sweep is the backstop — it converges
  stale rows to RevenueCat truth and discovers known subscribers with no row yet (a missed
  webhook). `GET /subscriptions/me` self-heals a missing/stale row by enqueuing an async
  reconciliation, never a synchronous RevenueCat call on the request path.
- The webhook is authenticated by an HMAC-SHA256 signature over the raw body (timestamp tolerance +
  constant-time compare), with a shared-secret bearer fallback — matching the sensitivity of a
  monetization-affecting endpoint.

## Alternatives Considered
- **Query RevenueCat synchronously per tier lookup.** Rejected: couples money/access decisions to a
  third party's latency and uptime, and blows the commission provider's bounded-lookup budget.
- **Store a single boolean PRO flag.** Rejected: cannot express per-role PRO, and a stored flag goes
  stale on expiry/cancellation without a derivation step.
- **Enqueue-then-ACK without an outbox.** Rejected: a crash or enqueue failure between ACK and
  enqueue silently loses an acknowledged, money-affecting event.
- **Keep `SUBSCRIPTION_TIER` owned/bound by commission-system.** Rejected: the real implementation
  needs the mirror + reconciliation; binding it in `subscriptions` and importing one-directionally
  keeps the dependency acyclic and each module single-responsibility.
- **A single global `last_event_at` per user.** Rejected: it would let a newer event for one
  entitlement suppress a valid late event for another.

## Consequences
- `commission-system` now consumes the real role-aware tier: a Cleaner/Host PRO resolves the reduced
  per-role commission through the live mirror instead of always FREE. The FREE-returning stub is
  deleted; coupling stays one-directional (Commission → Subscriptions) with no cycle.
- Two new reversible migrations must be applied: `1700000017000-CreateSubscriptions` and
  `1700000018000-CreateSubscriptionEvents`.
- The account-deletion cascade gains a `CLEANUP_SUBSCRIPTION_MIRROR` step (mirror row removed,
  ledger anonymized) alongside the existing RevenueCat cancel.
- Configuration must provide a webhook secret (HMAC signing preferred) and a non-empty RevenueCat
  entitlement id for every logical key, or the module fails startup in production.
- The mobile app gains the RevenueCat SDK + Paywalls V2 UI, a subscription store, and real
  `ad_free`/PRO gates; the client is a UI convenience that converges to `/subscriptions/me` and
  never grants entitlements.
- MVP platform matrix is iOS + Android; Amazon Appstore is out of scope and can be added later
  without a design change.

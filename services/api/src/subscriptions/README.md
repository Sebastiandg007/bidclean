# Subscriptions (RevenueCat)

## Purpose

The **source of truth for a user's subscription tier** (`FREE` vs `PRO`) across BidClean.
It integrates RevenueCat (the IAP system of record) and maintains a **durable, reconcilable
local mirror** of each user's entitlements (`cleaner_pro`, `host_pro`, `ad_free`), then
implements the `SUBSCRIPTION_TIER` contract for real — replacing the FREE-returning stub that
`commission-system` ships today.

Authority split (drives the whole design):

- **RevenueCat = source of truth** for purchase / renewal / entitlement state.
- **The BidClean mirror = authoritative runtime read model** for BidClean's own authorization
  and business decisions (tier resolution, commission gating, ad / PRO gates). The mirror never
  grants access on its own; it only reflects RevenueCat, reconciled via webhooks plus a periodic
  backstop sweep.

Tier is **derived, never stored as a flag**: it is computed at query time from active
entitlements with expiration always evaluated. Resolution is **role-aware** — the Host tier
derives from `host_pro` only and the Cleaner tier from `cleaner_pro` only, so a user can be PRO
in one role and FREE in the other. `ad_free` is independent and never implies PRO.

> Status: this module is under active construction (Spec 11 `revenuecat-subscriptions`). The
> full component set below reflects the target design; only the files currently present in this
> folder are marked as implemented. Update this table as files land.

## Files

| File | Responsibility | Status |
|------|---------------|--------|
| `subscriptions.types.ts` | `EntitlementKey`, `SubscriberRole`, `Store`, `RevenueCatEventType`, `DispatchStatus`, `SubscriberTier`, and the view / delta types (`EntitlementState`, `SubscriptionView`, `EntitlementDelta`). | Implemented |
| `subscriptions.constants.ts` | Env config + `validateSubscriptionsConfig()` (fail-fast); reuses `REVENUECAT_API_KEY` / `REVENUECAT_API_URL`; logical→configured entitlement id map (`ENTITLEMENT_ID_MAP`). | Implemented |
| `subscriptions.module.ts` | NestJS module; provides + exports the real `SUBSCRIPTION_TIER`; validates config. | Planned |
| `subscription-tier.service.ts` | `RealSubscriptionTierService`: `getTier` + `getRoleTier` derived from the mirror. | Implemented |
| `subscriptions.service.ts` | Read model (`getMyEntitlements`), self-heal trigger, mirror upsert orchestration. | Planned |
| `subscriptions.repository.ts` | Mirror + ledger/outbox reads and writes; dedup; per-entitlement ordering; atomic TRANSFER; reconciliation convergence + discovery; deletion cleanup. | Implemented |
| `subscriptions.controller.ts` | `GET /subscriptions/me` (JWT, scoped, self-heal on missing/stale). | Planned |
| `revenuecat/revenuecat.client.ts` | Versioned REST seam: `getSubscriber`, `deleteSubscriber`. | Implemented |
| `revenuecat/revenuecat.constants.ts` | Logical→configured entitlement id map + `toEntitlementKeys()` (maps external RevenueCat entitlement ids to internal keys). | Implemented |
| `revenuecat/revenuecat-signature.ts` | HMAC-SHA256 verify (timestamp tolerance + constant-time compare). | Implemented |
| `revenuecat/revenuecat-event.mapper.ts` | Pure: RevenueCat event → `EntitlementDelta[]`. | Implemented |
| `revenuecat/revenuecat-payload.sanitizer.ts` | Pure: whitelist safe fields only (no PII / secrets). | Implemented |
| `webhooks/revenuecat-webhook.controller.ts` | Public `POST /webhooks/revenuecat`; HMAC verify; dedup; ledger `RECEIVED`; enqueue; ACK. | Planned |
| `webhooks/revenuecat-webhook.processor.ts` | BullMQ: apply deltas per entitlement (out-of-order safe); mark `PROCESSED`. | Planned |
| `webhooks/subscription-dispatch.worker.ts` | Recovery: re-enqueue `RECEIVED`/`QUEUED` ledger rows not yet processed. | Planned |
| `reconciliation/subscription-reconciliation.service.ts` | `@Interval` sweep: converge existing rows + discover missing subscribers. | Planned |
| `entities/subscription.entity.ts` | `subscriptions` mirror (one row per user). | Implemented |
| `entities/subscription-event.entity.ts` | Append-only `subscription_events` ledger + outbox. | Implemented |
| `__tests__/subscription-tier.service.spec.ts` | Unit tests for role-aware tier derivation (active/expiry rules, empty mirror → FREE, `ad_free` never implies PRO). | Implemented |
| `__tests__/revenuecat-event.mapper.spec.ts` | Unit tests for the RevenueCat event → `EntitlementDelta[]` mapper. | Implemented |
| `__tests__/revenuecat-payload.sanitizer.spec.ts` | Unit tests for the payload field whitelist (no PII / secrets). | Implemented |
| `__tests__/revenuecat-signature.spec.ts` | Unit tests for HMAC-SHA256 verification (tolerance + constant-time compare). | Implemented |

## Domain Rules

- **Derive tier, never store a flag.** PRO for a role iff that role's entitlement is active with
  future/null expiry at query time.
- **Role-tier independence.** `cleaner_pro` → Cleaner tier only, `host_pro` → Host tier only;
  `getTier` (global) is PRO iff either role is PRO. `ad_free` never participates.
- **Per-entitlement ordering.** A delta applies to entitlement E only when its event timestamp is
  newer than E's `*_last_event_at`; a late event for one entitlement is never dropped because a
  newer event arrived for a different one.
- **Durable webhook delivery.** A webhook is ACKed only after its ledger row commits as
  `RECEIVED`; a recovery worker guarantees every `RECEIVED` row is eventually processed.
- **Server authority.** The mobile SDK's `customerInfo` is UI convenience only; anything affecting
  money or access reads the backend mirror. The client never grants entitlements.
- **Fail into last-known.** A RevenueCat outage degrades to the last-known mirror state and never
  blocks offer creation, match, or account deletion.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/subscriptions/me` | Caller's active entitlements + global/role tiers from the mirror (JWT, scoped). |
| POST | `/webhooks/revenuecat` | Public RevenueCat webhook ingress (HMAC-authenticated, not JWT). |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REVENUECAT_API_KEY` | RevenueCat secret REST key (reused from the deletion cascade) | Yes |
| `REVENUECAT_API_URL` | RevenueCat REST base URL | No (default v1) |
| `REVENUECAT_WEBHOOK_SIGNING_SECRET` | HMAC-SHA256 webhook signing secret (preferred) | Yes* |
| `REVENUECAT_WEBHOOK_AUTH_SECRET` | Shared-secret bearer fallback for the webhook | Yes* |
| `REVENUECAT_WEBHOOK_TOLERANCE_SECONDS` | Max webhook age (replay guard) | No (default 300) |
| `SUBSCRIPTION_RECONCILE_INTERVAL_MS` | Reconciliation sweep interval | No (default 900000) |
| `SUBSCRIPTION_STALE_WINDOW_MS` | Staleness window for reconcile + self-heal | No (default 86400000) |
| `SUBSCRIPTION_RECONCILE_BATCH` | Rows per reconcile sweep | No (default 100) |
| `SUBSCRIPTION_DISPATCH_GRACE_MS` | Age before the recovery worker re-enqueues a `RECEIVED` row | No (default 60000) |
| `SUBSCRIPTION_MAX_RETRIES` / `SUBSCRIPTION_BACKOFF_DELAY_MS` | BullMQ retry / backoff | No |
| `RC_ENTITLEMENT_CLEANER_PRO` / `RC_ENTITLEMENT_HOST_PRO` / `RC_ENTITLEMENT_AD_FREE` | RevenueCat entitlement ids (logical→external map) | Yes |

\* At least one webhook secret is required (HMAC signing preferred). Server secret keys are never
shipped in the mobile app; the app uses only the `EXPO_PUBLIC_RC_*` public keys. Secrets are
referenced by name only and never committed.

## Dependencies

- **commission-system (Spec 10):** owns the `SUBSCRIPTION_TIER` contract; this module binds the
  real implementation and extends the contract with `getRoleTier`. Wiring is one-directional
  (`Commission → Subscriptions` via the DI token) — no circular dependency.
- **user-authentication / user-roles (Specs 1, 2):** provide the internal user UUID
  (RevenueCat `app_user_id`), `keycloakId`, and the active role for the role-appropriate paywall.
- **user-profile (Spec 4):** the account-deletion cascade cancels RevenueCat and this module
  extends it with mirror cleanup.
- **offer-radar (Spec 7):** consumes the `ad_free` entitlement via `useAdVisibility`.
- **RevenueCat:** system of record and webhook/reconciliation authority.
- **Redis / BullMQ:** async webhook processing, recovery, and reconciliation scheduling.

## Testing

No live RevenueCat is required — the `RevenueCatClient` seam and a faked repository cover
ingestion, resolution, recovery, and reconciliation. Property-based tests (fast-check) cover the
correctness properties P1–P18; unit, integration/scenario, and mobile tests are added as the
corresponding files land.

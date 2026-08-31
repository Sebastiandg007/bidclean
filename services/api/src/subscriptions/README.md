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
| `subscriptions.module.ts` | NestJS module; provides + exports the real `SUBSCRIPTION_TIER`; validates config. | Implemented |
| `subscription-tier.service.ts` | `RealSubscriptionTierService`: `getTier` + `getRoleTier` derived from the mirror. | Implemented |
| `subscriptions.service.ts` | Read model (`getMyEntitlements`), self-heal trigger, mirror upsert orchestration. | Implemented |
| `subscriptions.repository.ts` | Mirror + ledger/outbox reads and writes; dedup; per-entitlement ordering; atomic TRANSFER; reconciliation convergence + discovery; deletion cleanup. | Implemented |
| `subscriptions.controller.ts` | `GET /subscriptions/me` (JWT, scoped, self-heal on missing/stale). | Implemented |
| `revenuecat/revenuecat.client.ts` | Versioned REST seam: `getSubscriber`, `deleteSubscriber`. | Implemented |
| `revenuecat/revenuecat.constants.ts` | Logical→configured entitlement id map + `toEntitlementKeys()` (maps external RevenueCat entitlement ids to internal keys). | Implemented |
| `revenuecat/revenuecat-signature.ts` | HMAC-SHA256 verify (timestamp tolerance + constant-time compare). | Implemented |
| `revenuecat/revenuecat-event.mapper.ts` | Pure: RevenueCat event → `EntitlementDelta[]`. | Implemented |
| `revenuecat/revenuecat-payload.sanitizer.ts` | Pure: whitelist safe fields only (no PII / secrets). | Implemented |
| `webhooks/revenuecat-webhook.controller.ts` | Public `POST /webhooks/revenuecat`; HMAC verify; dedup; ledger `RECEIVED`; enqueue; ACK. | Implemented |
| `webhooks/revenuecat-webhook.processor.ts` | BullMQ: apply deltas per entitlement (out-of-order safe); mark `PROCESSED`; `onFailed` dead-letters to `FAILED` on retry exhaustion. | Implemented |
| `webhooks/subscription-dispatch.worker.ts` | Recovery: re-enqueue `RECEIVED`/`QUEUED` ledger rows not yet processed. | Implemented |
| `reconciliation/subscription-reconciliation.service.ts` | `@Interval` sweep: converge existing rows + discover missing subscribers. | Implemented |
| `entities/subscription.entity.ts` | `subscriptions` mirror (one row per user). | Implemented |
| `entities/subscription-event.entity.ts` | Append-only `subscription_events` ledger + outbox. | Implemented |
| `__tests__/subscription-tier.service.spec.ts` | Unit tests for role-aware tier derivation (active/expiry rules, empty mirror → FREE, `ad_free` never implies PRO). | Implemented |
| `__tests__/subscription-tier.property.spec.ts` | Property-based tests (fast-check) for tier derivation: P1 tier-derivation correctness, P2 backward-compatible default, P11 role-tier independence, P12 `ad_free` non-implication, P17 role-specific tier. | Implemented |
| `__tests__/revenuecat-event.mapper.spec.ts` | Unit tests for the RevenueCat event → `EntitlementDelta[]` mapper. | Implemented |
| `__tests__/revenuecat-payload.sanitizer.spec.ts` | Unit tests for the payload field whitelist (no PII / secrets). | Implemented |
| `__tests__/revenuecat-signature.spec.ts` | Unit tests for HMAC-SHA256 verification (tolerance + constant-time compare). | Implemented |
| `__tests__/revenuecat-webhook.processor.spec.ts` | Unit tests for the BullMQ processor: applies deltas + PROCESSED, idempotent no-op on already-PROCESSED, unknown event → empty deltas (still PROCESSED), missing ledger row skip, FAILED on retry exhaustion. | Implemented |
| `__tests__/subscription-reconciliation.service.spec.ts` | Unit tests for the reconciliation sweep: converge stale rows, no-op when correct, discover missing subscribers (P18), RevenueCat outage leaves the mirror untouched, and a failing repository query never throws. | Implemented |
| `__tests__/subscription-webhook.property.spec.ts` | Property-based tests (fast-check) for webhook authenticity, ingestion, and durability: P3 signature/tamper/tolerance, P4 idempotent ingestion, P5/P15 out-of-order + per-entitlement convergence, P9 no sensitive persistence, P13 transfer integrity, P16 webhook durability. | Implemented |
| `__tests__/subscription-reconciliation.property.spec.ts` | Property-based tests (fast-check) for reconciliation: P6 convergence, P8 safe degradation on RevenueCat outage, P18 discovery of missing subscribers. | Implemented |
| `__tests__/subscription-config.property.spec.ts` | Property-based tests (fast-check) for P10 configuration integrity: production startup fails when any entitlement id mapping is missing (no silent hardcoded fallback). | Implemented |
| `__tests__/revenuecat.client.spec.ts` | Unit tests for the REST seam (`getSubscriber` / `deleteSubscriber`): entitlement mapping, versioned URL, and error handling. | Implemented |
| `__tests__/revenuecat-webhook.controller.spec.ts` | Unit tests for the public webhook ingress: HMAC verify, dedup, ledger `RECEIVED`, enqueue, and ACK. | Implemented |
| `__tests__/subscription-dispatch.worker.spec.ts` | Unit tests for the recovery worker: re-enqueues un-processed `RECEIVED`/`QUEUED` rows past the grace window. | Implemented |
| `__tests__/subscriptions.controller.spec.ts` | Unit tests for `GET /subscriptions/me`: JWT scoping and self-heal on a missing/stale mirror. | Implemented |
| `__tests__/subscriptions.repository.spec.ts` | Unit tests for the repository over the in-memory DataSource: dedup, per-entitlement ordering, atomic TRANSFER, dispatch lifecycle, discovery, and deletion cleanup. | Implemented |
| `__tests__/subscription.scenarios.spec.ts` | Integration/scenario tests wiring the real modules together over an in-memory DataSource + fake RevenueCat client: purchase→mirror→commission (19.1), host-only PRO split (19.2), expiration→FREE (19.3), recovery of an un-enqueued event (19.4), out-of-order A/B (19.5), TRANSFER (19.6), reconciliation heal+discover (19.7), deletion cleanup + flat commission (19.8). | Implemented |
| `__tests__/support/in-memory-data-source.ts` | Test support: a minimal behavioral in-memory stand-in for TypeORM's `DataSource` (unique violation, ordering, TRANSFER, dispatch lifecycle) so the repository runs without live Postgres. | Implemented |

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
backend correctness properties: tier resolution (P1, P2, P11, P12, P17) in
`__tests__/subscription-tier.property.spec.ts`; webhook authenticity, ingestion, and durability
(P3, P4, P5, P9, P13, P15, P16) in `__tests__/subscription-webhook.property.spec.ts`;
reconciliation (P6, P8, P18) in `__tests__/subscription-reconciliation.property.spec.ts`; and
configuration integrity (P10) in `__tests__/subscription-config.property.spec.ts`. P7 and P14 are
structural (server-authoritative reads) and are covered by the mobile store tests, which land with
the corresponding files.

On top of the unit and property layers, `__tests__/subscription.scenarios.spec.ts` wires the
**real** modules together — repository, tier service, event mapper/sanitizer, reconciliation, and
the commission provider — over the shared in-memory DataSource
(`__tests__/support/in-memory-data-source.ts`) and a fake `RevenueCatClient`, with no live infra.
These end-to-end scenarios validate the cross-module behaviors that unit tests can't: webhook →
mirror → commission resolution, the host-only PRO role split, expiration, recovery of an
un-enqueued event, out-of-order delivery, TRANSFER, reconciliation heal/discovery, and the
deletion cascade reverting to flat FREE commission.

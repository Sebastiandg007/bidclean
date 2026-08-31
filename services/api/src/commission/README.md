# Commission System

## Purpose

Resolves **which commission rate applies** to each side of a service — the Host service fee
and the Cleaner commission — from versioned, scoped rules, and records who changed those
rules. It never computes cents, never moves money, never owns subscriptions, and never serves
analytics. The pure cents arithmetic stays in each consumer's own `CommissionService`.

The two rates are resolved at **two different moments**, because they depend on actors known
at different times:

- **Host service fee — at offer creation.** `offer-publishing` calls `resolveHostRate` and
  feeds the resolved bps into its own `CommissionService`, snapshotting the Host rate onto the
  offer (as before).
- **Cleaner commission — at match.** `offer-negotiation` calls `resolveCleanerRate` for the
  winning Cleaner (direct accept / accepted proposal), computes the authoritative payout with
  its own `CommissionService`, and snapshots the Cleaner rate onto the winning proposal/offer.

Coupling is one-directional via the `COMMISSION_RATES` DI token — this module does **not**
import `OffersModule` or `CommissionService`, so there is no circular dependency.

## Files

| File | Responsibility |
|------|---------------|
| `commission.module.ts` | NestJS module; wires providers, exports `COMMISSION_RATES` + `SUBSCRIPTION_TIER`, validates config, wires the cache loader. Does NOT import `OffersModule`. |
| `commission.constants.ts` | Env-configurable values + `validateCommissionConfig()` (fail-fast); re-exports `OFFER_HOST_FEE_RATE_BPS`/`OFFER_CLEANER_RATE_BPS` as the single default source of truth. |
| `commission.types.ts` | `SubscriberTier`, `RateSide`, `RuleAuditAction`, `HostRateContext`, `CleanerRateContext`, `ResolvedRate`, `CommissionRuleRow`. |
| `rate-resolver.service.ts` | `CommissionRateResolver.resolveSide(...)` — pure per-side selection over the cached ruleset (NULL scope = wildcard; no match → env default). |
| `rule-specificity.ts` | `specificityScore()` + `compareBySpecificityThenPriorityThenDateThenId()` (deterministic ordering). |
| `commission-rules.cache.ts` | In-memory active ruleset; half-open effective-window filter; keeps last-good snapshot on refresh failure. |
| `commission-cache-invalidation.ts` | Redis pub/sub cross-instance invalidation + TTL refresh backstop; dedicated subscriber connection. |
| `commission-rules.repository.ts` | Rule reads/writes + audit append in one transaction; maps the overlap exclusion-constraint violation to 409; never physically deletes a rule. |
| `commission-rates.provider.ts` | Implements `COMMISSION_RATES`; bounded tier lookup (safe FREE fallback), never throws (degrades to env default), never computes cents. |
| `contracts/commission-rates.interface.ts` | `CommissionRateContract` (`resolveHostRate`/`resolveCleanerRate`/`preview*`) + `COMMISSION_RATES` token. |
| `contracts/subscription-tier.interface.ts` | `SubscriptionTierContract` + `SUBSCRIPTION_TIER` token. |
| `contracts/default-subscription-tier.service.ts` | Stub returning FREE (replaced by `revenuecat-subscriptions`, Spec 11). |
| `admin/commission-admin.service.ts` | Validated writes: business-cap check (400), transactional rule+audit write, cache invalidation. |
| `admin/commission-admin.controller.ts` | Operator CRUD for rules (JWT + admin allowlist + rate limit). |
| `guards/commission-admin.guard.ts` | Operator authorization via `COMMISSION_ADMIN_KEYCLOAK_IDS` allowlist. |
| `guards/commission-admin-rate-limit.guard.ts` | Per-operator Redis rate limit on admin endpoints. |
| `dto/*.ts` | Create/update rule DTOs (class-validator) + response mappers. |
| `entities/commission-rule.entity.ts` | `commission_rules` table entity (one side per rule via `applies_to`). |
| `entities/commission-rule-audit.entity.ts` | Append-only `commission_rule_audit` table entity. |

## Domain Rules

- **One rule = one side.** Each `commission_rules` row sets exactly one `applies_to`
  (`HOST` or `CLEANER`) with a single `rate_bps`. Host and Cleaner resolve independently.
- **Most-specific wins.** Winner ordering: specificity score (count of exact non-`ANY`
  dimensions) → priority → latest `effective_from` → lowest UUID (fully deterministic).
- **Effective windows.** Half-open `[effective_from, effective_to)`; future-dated rules are
  inert until their window opens (enables scheduled commission changes without a deploy).
- **No overlap.** A GiST exclusion constraint prevents two active rules with identical scope
  and overlapping windows (concurrency-safe; a plain unique index cannot).
- **Never deleted.** Rules are retired via DEACTIVATE / past `effective_to`; the audit FK is
  `ON DELETE RESTRICT` so history survives.
- **Backward compatible.** With an empty ruleset, resolution returns exactly the env-default
  rates — identical to the previous flat model.

## API (admin, operator only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/commission/rules` | Create a rule (overlap → 409, over-cap → 400); audit CREATE |
| PATCH | `/admin/commission/rules/:id` | Update a rule; audit UPDATE |
| POST | `/admin/commission/rules/:id/activate` | Activate; audit ACTIVATE |
| POST | `/admin/commission/rules/:id/deactivate` | Deactivate; audit DEACTIVATE |
| GET | `/admin/commission/rules` | List rules (filter by side/active) |
| GET | `/admin/commission/rules/:id/audit` | Rule change history |

No client-facing breakdown endpoint is added; the existing `GET /offers/:id/price-breakdown`
serves the snapshotted rates.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OFFER_HOST_FEE_RATE` | Default Host fee bps (shared with offer-publishing) | Yes |
| `OFFER_CLEANER_RATE` | Default Cleaner commission bps (shared) | Yes |
| `COMMISSION_RULES_CACHE_TTL_MS` | Ruleset cache refresh interval | No (default 60000) |
| `COMMISSION_TIER_LOOKUP_TIMEOUT_MS` | Bound on the subscriber-tier lookup | No (default 500) |
| `COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE` | Rate limit on admin endpoints | No (default 30) |
| `COMMISSION_MAX_HOST_RATE_BPS` | Business-policy cap on the Host fee | No (default 5000) |
| `COMMISSION_MAX_CLEANER_RATE_BPS` | Business-policy cap on the Cleaner commission | No (default 5000) |
| `COMMISSION_CACHE_INVALIDATION_CHANNEL` | Redis pub/sub channel for cache invalidation | No (default `commission:rules:invalidate`) |
| `COMMISSION_ADMIN_KEYCLOAK_IDS` | Comma-separated operator Keycloak ids | No (empty = no operators) |

## Dependencies

- **offer-publishing (Spec 6):** owns `CommissionService` (cents math) and the offer Host-rate
  snapshot; consumes `resolveHostRate` at creation.
- **offer-negotiation (Spec 8):** owns match finalization; consumes `resolveCleanerRate` at match.
- **revenuecat-subscriptions (Spec 11, future):** real `SUBSCRIPTION_TIER` implementation and
  owner of the last-known-tier cache. Until then a stub reports FREE.
- **Redis:** transport for distributed cache invalidation.

## Testing

- `__tests__/rate-resolver.spec.ts` — resolver + specificity comparator (NULL wildcard,
  env-default fallback, country-beats-ANY, PRO preference, deterministic tie-break).
- `__tests__/commission-rules.cache.spec.ts` — window filtering, future-dated inert,
  keeps-last-good on refresh failure.
- `__tests__/commission-admin.service.spec.ts` — cap → 400, overlap → 409 propagation,
  invalidation on write, deactivate keeps row.
- `__tests__/commission-rates.provider.spec.ts` — tier via contract, safe degradation to FREE,
  env-default on resolver error, preview shares resolution.
- `__tests__/commission-admin.controller.spec.ts` — allowlist guard (403), actor resolution,
  list/audit wiring.
- `__tests__/commission.property.spec.ts` — fast-check properties P1–P11.
- `__tests__/commission.scenarios.spec.ts` — end-to-end scenarios (overlap 409, distributed
  invalidation, country-beats-ANY, future-dated flip, PRO cleaner at match, tier timeout → FREE,
  audit trail).

No live infrastructure is required; unit/property/scenario tests use faked repositories and a
fake Redis, matching the negotiation/payments test convention.

# Implementation Plan: Commission System

## Overview

The commission-system resolves WHICH commission rate applies to each side of a service - the Host service fee and the Cleaner commission - from versioned, scoped `commission_rules`, and records who changed those rules. It never computes cents, never moves money, never owns subscriptions, and never serves analytics.

The two rates are resolved at TWO moments because they depend on actors known at different times: the Host fee is resolved at offer creation (Host exists) and the Cleaner commission is resolved at match (winning Cleaner exists). Each consuming module (offer-publishing at creation, offer-negotiation at match) obtains the resolved bps through the `COMMISSION_RATES` contract and feeds them to its OWN `CommissionService` for the cents math, then snapshots the result. commission-system does NOT import `OffersModule` or `CommissionService`, so there is no circular dependency - coupling is one-directional via a DI token.

Implementation is bottom-up: shared types + env config first, then the two DB tables (rules + append-only audit with an exclusion constraint and ON DELETE RESTRICT), then the pure specificity comparator + resolver, then the cache with distributed Redis invalidation, then the repository + transactional admin write path, then the SUBSCRIPTION_TIER stub + the COMMISSION_RATES provider, then the admin controller, then wiring, and finally the two consumer integration points, followed by property-based, unit, and integration/scenario tests.

## Tasks

- [x] 1. Environment configuration & constants
  - [x] 1.1 Add commission environment variables to `.env.example`
    - Add `COMMISSION_RULES_CACHE_TTL_MS`, `COMMISSION_TIER_LOOKUP_TIMEOUT_MS`, `COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE`, `COMMISSION_MAX_HOST_RATE_BPS`, `COMMISSION_MAX_CLEANER_RATE_BPS`, `COMMISSION_CACHE_INVALIDATION_CHANNEL`
    - `OFFER_HOST_FEE_RATE` / `OFFER_CLEANER_RATE` already exist - do NOT duplicate; document that they are the shared default source of truth
    - _Requirements: 8.1, 8.2_
  - [x] 1.2 Create commission constants with startup validation
    - Create `services/api/src/commission/commission.constants.ts` re-exporting `OFFER_HOST_FEE_RATE_BPS` / `OFFER_CLEANER_RATE_BPS` from `../offers/offers.constants` (single source of truth, no divergent value) and parsing the `COMMISSION_*` values
    - Implement `validateCommissionConfig()` fail-fast: TTL/timeout/rate-limit > 0; both business caps integers in [0, 10000]; inherited default bps in [0, 10000] and <= their side cap; invalidation channel non-empty
    - No hardcoded rate/country/tier literals in logic
    - _Requirements: 7 (env naming), 8.2, 8.3, 8.4, 5.10_

- [x] 2. Backend — Database Schema & Migration
  - [x] 2.1 Create the commission_rules migration
    - Create `services/api/src/migrations/1700000015000-CreateCommissionRules.ts` implementing `MigrationInterface` with `up()`/`down()`
    - `CREATE EXTENSION IF NOT EXISTS btree_gist`
    - Table `commission_rules`: id UUID PK, `country` CHAR(2) nullable (NULL=ANY), `subscriber_tier` VARCHAR(10) nullable, `service_type` VARCHAR(30) nullable, `applies_to` VARCHAR(10) NOT NULL, `rate_bps` INTEGER NOT NULL, `priority` INTEGER NOT NULL DEFAULT 0, `effective_from` TIMESTAMPTZ NOT NULL DEFAULT NOW(), `effective_to` TIMESTAMPTZ nullable, `is_active` BOOLEAN NOT NULL DEFAULT TRUE, `created_by`/`updated_by` UUID FK users ON DELETE SET NULL, created_at/updated_at
    - Constraints: `chk_commission_tier`, `chk_commission_applies_to`, `chk_commission_country`, `chk_commission_rate_bps` (0..10000)
    - Index `idx_commission_rules_lookup (applies_to, is_active, effective_from) WHERE is_active`
    - Exclusion constraint `excl_commission_rule_overlap EXCLUDE USING gist (applies_to =, COALESCE(country,'*') =, COALESCE(subscriber_tier,'*') =, COALESCE(service_type,'*') =, tstzrange(effective_from, effective_to, '[)') &&) WHERE (is_active)`
    - `down()` drops the table (extension left in place)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_
  - [x] 2.2 Create the commission_rule_audit migration
    - Create `services/api/src/migrations/1700000016000-CreateCommissionRuleAudit.ts` with `up()`/`down()`
    - Table `commission_rule_audit`: id UUID PK, `rule_id` UUID NOT NULL FK commission_rules **ON DELETE RESTRICT** (never cascade away history), `action` VARCHAR(12) NOT NULL, `actor_id` UUID FK users ON DELETE SET NULL, `old_values` JSONB nullable, `new_values` JSONB NOT NULL, `reason` TEXT nullable, created_at
    - Constraint `chk_commission_audit_action` (CREATE|UPDATE|ACTIVATE|DEACTIVATE); indexes on (rule_id, created_at) and (actor_id)
    - _Requirements: 6.1, 6.3, 6.5, 5.9_

- [x] 3. Backend — Types & Entities
  - [x] 3.1 Create commission types and enums
    - Create `services/api/src/commission/commission.types.ts` with `SubscriberTier` (FREE|PRO), `RateSide` (HOST|CLEANER), `RuleAuditAction`, and view types `HostRateContext`, `CleanerRateContext`, `ResolvedRate` ({ rateBps, ruleId|null })
    - Currency intentionally excluded from both contexts (v1)
    - _Requirements: 1.1, 3.2, 4.1_
  - [x] 3.2 Create the entities
    - Create `entities/commission-rule.entity.ts` and `entities/commission-rule-audit.entity.ts` matching the migrations, with JSDoc on every column; rates typed as integer; `applies_to` typed via `RateSide`
    - Entities auto-discovered by the existing `**/*.entity.ts` glob
    - _Requirements: 5.2, 5.3, 6.3_

- [x] 4. Backend — Pure Resolution Core
  - [x] 4.1 Implement the specificity comparator (pure)
    - Create `services/api/src/commission/rule-specificity.ts`: `specificityScore(rule)` = count of non-NULL scope dims; `compareBySpecificityThenPriorityThenDateThenId(a,b)` strict ordering (specificity down, priority down, effective_from down, id up)
    - No I/O, no arithmetic on money
    - _Requirements: 1.2, 1.8_
  - [x] 4.2 Implement CommissionRateResolver (pure selection)
    - Create `rate-resolver.service.ts`: `resolveSide(side, country, tier, serviceType, at)` filters cached active rules by side + `matches` (NULL scope = wildcard), returns the winner via the comparator, or `{ rateBps: defaultBps(side), ruleId: null }` when none match
    - `defaultBps` reads the inherited `OFFER_*_RATE_BPS` constants; performs no cents math
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.7, 3.1, 3.3, 4.4_
  - [x]* 4.3 Unit tests for specificity + resolver
    - specificity score for all scope combinations; most-specific-wins; NULL=wildcard matching; empty-ruleset returns env default per side; deterministic tie-break to lowest UUID
    - _Requirements: 1.2, 1.3, 3.1_

- [x] 5. Backend — Rules Cache & Distributed Invalidation
  - [x] 5.1 Implement CommissionRulesCache
    - Create `commission-rules.cache.ts`: holds active ruleset; `activeRules(at)` filters `is_active` AND `effective_from <= at < (effective_to ?? Infinity)` (future-dated excluded, P8); refresh on TTL interval and on demand; on refresh failure keep last good snapshot (log, never empty)
    - _Requirements: 1.4, 5.7_
  - [x] 5.2 Implement distributed cache invalidation
    - Create `commission-cache-invalidation.ts`: Redis pub/sub publisher + subscriber on `COMMISSION_CACHE_INVALIDATION_CHANNEL`; on a rule write the writing instance refreshes locally AND publishes; every instance refreshes on message so no instance serves a stale rate
    - _Requirements: Reliability (distributed invalidation)_
  - [x]* 5.3 Unit tests for cache + invalidation
    - window filtering incl. future-dated inert; refresh-failure keeps last good; received invalidation triggers refresh; publish on write
    - _Requirements: 1.4, 5.7_

- [x] 6. Checkpoint — Resolution core compiles and unit tests pass
  - Ensure constants, migrations, types, entities, specificity, resolver, cache, and invalidation compile and their unit tests pass; ask the user if questions arise.

- [x] 7. Backend — Repository & Transactional Admin Write Path
  - [x] 7.1 Implement CommissionRulesRepository
    - Create `commission-rules.repository.ts`: read active rules for the cache; create/update/activate/deactivate a rule AND append the corresponding `commission_rule_audit` row in ONE transaction; map the exclusion-constraint violation to a domain conflict; never physically delete a rule
    - _Requirements: 5.4, 5.9, 6.1, 6.2_
  - [x] 7.2 Implement CommissionAdminService (validated writes)
    - Create `admin/commission-admin.service.ts`: enforce the business-policy cap per side (reject over-cap -> 400), perform the transactional write + audit append via the repository, then trigger local + distributed cache invalidation; overlap conflicts surface as 409 from the constraint
    - Audit `old_values`/`new_values` store scope + rate bps + window + flags only
    - _Requirements: 5.4, 5.10, 6.1, 6.4_
  - [x]* 7.3 Unit tests for repository + admin service
    - transactional rule+audit write; overlap violation -> 409; over-cap -> 400; deactivate keeps row + writes audit; physical delete attempt rejected by FK RESTRICT; invalidation published on write
    - _Requirements: 5.4, 5.9, 5.10, 6.1, 6.2_

- [x] 8. Backend — Contracts (SUBSCRIPTION_TIER + COMMISSION_RATES)
  - [x] 8.1 Implement the SUBSCRIPTION_TIER contract + stub
    - Create `contracts/subscription-tier.interface.ts` (`SubscriptionTierContract` + `SUBSCRIPTION_TIER = Symbol('SUBSCRIPTION_TIER')`) and `contracts/default-subscription-tier.service.ts` returning FREE for every user
    - Document that the real impl + last-known-tier cache belongs to revenuecat-subscriptions (Spec 11); commission-system stores no tier
    - _Requirements: 2.1, 2.3_
  - [x] 8.2 Implement the COMMISSION_RATES contract + provider
    - Create `contracts/commission-rates.interface.ts` (`CommissionRateContract` with `resolveHostRate`, `resolveCleanerRate`, `previewHostRate`, `previewCleanerRate` + `COMMISSION_RATES = Symbol('COMMISSION_RATES')`)
    - Create `commission-rates.provider.ts`: for each side, look up the actor tier via SUBSCRIPTION_TIER bounded by `COMMISSION_TIER_LOOKUP_TIMEOUT_MS` (on timeout/error fall back to FREE, relying on the contract impl's own last-known tier), call the resolver, return `ResolvedRate`; NEVER throws (degrades to env default), NEVER computes cents
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 4.1, 4.4, 4.6, 7.4, 7.5_
  - [x]* 8.3 Unit tests for stub + provider
    - stub returns FREE; provider resolves each side against its actor tier; tier timeout -> FREE, never throws; resolver error -> env default; preview persists nothing
    - _Requirements: 2.1, 2.5, 2.6, 7.5_

- [x] 9. Backend — Admin Controller
  - [x] 9.1 Implement DTOs
    - Create `dto/create-rule.dto.ts`, `dto/update-rule.dto.ts`, `dto/rule-response.dto.ts` with class-validator: `applies_to` enum, tier enum, ISO country or null, rate_bps int 0..10000, optional service_type, priority int, effective_from/to ISO, optional reason
    - _Requirements: 5.2, 5.3, 6.4_
  - [x] 9.2 Implement CommissionAdminController
    - Create `admin/commission-admin.controller.ts`: class-level `@UseGuards(JwtAuthGuard, AdminGuard)`, rate-limited via `COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE`; endpoints POST/PATCH/activate/deactivate/list/audit per the design table; 201/200/409/400/401/403
    - _Requirements: 5.4, 6.1, Security (auth + rate limit)_
  - [x]* 9.3 Unit tests for controller
    - guards enforced (403 non-admin); create -> 201; overlap -> 409; over-cap/invalid -> 400; audit list returns history
    - _Requirements: 5.4, 6.1_

- [x] 10. Backend — Module Wiring
  - [x] 10.1 Wire CommissionModule
    - Create `commission.module.ts` importing `TypeOrmModule.forFeature([CommissionRule, CommissionRuleAudit, User])`, Redis for invalidation; register resolver, cache, invalidation, repository, admin service/controller, `{ provide: SUBSCRIPTION_TIER, useClass: DefaultSubscriptionTierService }`, `{ provide: COMMISSION_RATES, useClass: CommissionRatesProvider }`; `exports: [COMMISSION_RATES, SUBSCRIPTION_TIER]`; call `validateCommissionConfig()` in `onModuleInit`; register in `AppModule`
    - MUST NOT import `OffersModule` or `CommissionService` (no circular dependency)
    - _Requirements: 4.1, 4.6, 8.2_

- [x] 11. Checkpoint — commission-system module complete in isolation
  - Ensure the full module compiles, wires, validates config, and all unit tests pass with no dependency on OffersModule; ask the user if questions arise.

- [x] 12. Backend — Consumer Integration (Host at creation)
  - [x] 12.1 Integrate resolveHostRate into offer creation
    - Update `offers.module.ts` to import `CommissionModule` and inject `COMMISSION_RATES`; update `OffersService.create` to call `resolveHostRate({ country: property.addressCountry, hostId, serviceType })` and pass the resolved `hostFeeRateBps` into its OWN `CommissionService.getFullBreakdown`, replacing the current no-argument call; snapshot as today
    - On contract failure, fall back to the existing env-default `getFullBreakdown(price)` path (shared source of truth)
    - _Requirements: 4.2, 4.4, 4.7, 7.2_
  - [x]* 12.2 Unit/integration tests for creation integration
    - resolved Host bps snapshotted onto the offer; empty-ruleset path byte-for-byte current behavior; contract failure -> env-default fallback; existing `GET /offers/:id/price-breakdown` reflects the snapshot
    - _Requirements: 4.2, 4.4, 7.2_

- [x] 13. Backend — Consumer Integration (Cleaner at match)
  - [x] 13.1 Integrate resolveCleanerRate into match finalization
    - Update `negotiation.module.ts` to import `CommissionModule` and inject `COMMISSION_RATES`; at match finalization (`acceptOffer` direct accept and `acceptProposal`), call `resolveCleanerRate({ country, cleanerId: winningCleanerId, serviceType })`, compute the authoritative Cleaner payout via negotiation's OWN `CommissionService`, and snapshot the resolved Cleaner rate onto the winning proposal / offer
    - On contract failure, fall back to the offer's existing snapshot / env-default path
    - _Requirements: 4.3, 4.4, 4.7, 7.2_
  - [x]* 13.2 Unit/integration tests for match integration
    - resolved Cleaner bps snapshotted on the winning proposal at match; PRO cleaner + FREE host on the same offer; contract failure fallback; a rule change after match never alters the snapshot (P11)
    - _Requirements: 4.3, 4.4, 7.2_

- [x] 14. Checkpoint — End-to-end two-moment resolution works
  - Ensure creation resolves the Host rate and match resolves the Cleaner rate, both snapshotted correctly, with no circular dependency and all tests passing; ask the user if questions arise.

- [x] 15. Property-Based Tests (fast-check)
  - [x]* 15.1 Property test: Money Integrity
    - **Property 1: Money Integrity**
    - **Validates: Requirements 1.5, 8.4**
    - Random rules/contexts; every resolved rateBps is a non-negative integer <= 10000; module does no float/cents math
  - [x]* 15.2 Property test: Deterministic Resolution
    - **Property 2: Deterministic Resolution**
    - **Validates: Requirements 1.2, 1.8**
    - For a fixed ruleset + side + context, resolveSide always returns the same (rateBps, ruleId)
  - [x]* 15.3 Property test: Most-Specific Wins
    - **Property 3: Most-Specific Wins**
    - **Validates: Requirements 1.2, 3.1**
    - Higher specificity always outranks lower; exact beats ANY on the same dimension
  - [x]* 15.4 Property test: Backward-Compatible Fallback
    - **Property 4: Backward-Compatible Fallback**
    - **Validates: Requirements 1.3, 5.5, 4.4**
    - Empty ruleset -> exactly the env-default bps per side
  - [x]* 15.5 Property test: Snapshot Immutability Preserved
    - **Property 5: Snapshot Immutability Preserved**
    - **Validates: Requirements 4.5, 7.5**
    - Module never writes offers/negotiation/payment tables; no re-resolution of an existing offer
  - [x]* 15.6 Property test: Tier Isolation & Safe Degradation
    - **Property 6: Tier Isolation & Safe Degradation**
    - **Validates: Requirements 2.1, 2.5, 2.6**
    - Tier only via contract; timeout/error -> last-known then FREE; never blocks; no tier stored
  - [x]* 15.7 Property test: No Double Calculation & No Circular Dependency
    - **Property 7: No Double Calculation & No Circular Dependency**
    - **Validates: Requirements 4.6**
    - Module has no import of offer-publishing/CommissionService; consumers own the cents math
  - [x]* 15.8 Property test: Effective-Window Correctness
    - **Property 8: Effective-Window Correctness**
    - **Validates: Requirements 1.4, 5.7**
    - Only rules active and within window selected; future-dated inert until effective_from
  - [x]* 15.9 Property test: Independent Host/Cleaner Resolution
    - **Property 9: Independent Host/Cleaner Resolution**
    - **Validates: Requirements 1.7, 2.4**
    - Host and Cleaner sides resolve independently; one matched offer may carry FREE host + PRO cleaner rule ids
  - [x]* 15.10 Property test: Audit Completeness & No Physical Delete
    - **Property 10: Audit Completeness & No Physical Delete**
    - **Validates: Requirements 6.1, 6.2, 5.9**
    - Every mutation writes exactly one immutable audit row; rules never physically deleted; FK RESTRICT
  - [x]* 15.11 Property test: Rule-Version / Temporal Correctness
    - **Property 11: Rule-Version / Temporal Correctness**
    - **Validates: Requirements 1.4, 5.7**
    - A mutation after a resolution timestamp never changes that resolution's outcome

- [x] 16. Integration & Scenario Tests
  - [x]* 16.1 Integration test: admin create -> overlap 409
    - Two overlapping active rules; exclusion constraint blocks the second (409); different scopes allowed
    - _Requirements: 5.4_
  - [x]* 16.2 Integration test: distributed cache invalidation
    - Rule write on instance A -> invalidation published -> instance B reflects the change on next resolve
    - _Requirements: Reliability (distributed invalidation)_
  - [x]* 16.3 Integration test: country-specific rule beats ANY
    - CO-scoped rule wins over ANY-country for a CO context; other countries use ANY
    - _Requirements: 3.1, 3.3_
  - [x]* 16.4 Integration test: scheduled (future-dated) rule flips at boundary
    - Future `effective_from` rule inert before the boundary, authoritative after
    - _Requirements: 5.7_
  - [x]* 16.5 Integration test: PRO cleaner resolved at match
    - Cleaner tier PRO (stub swapped in test) -> reduced Cleaner rate at match; Host stays FREE at creation
    - _Requirements: 2.2, 2.4, 4.3_
  - [x]* 16.6 Integration test: tier lookup timeout -> FREE, never blocks
    - Slow/erroring SUBSCRIPTION_TIER -> resolution degrades to FREE and creation/match proceed
    - _Requirements: 2.5, 2.6_
  - [x]* 16.7 Integration test: audit trail
    - CREATE/UPDATE/ACTIVATE/DEACTIVATE each append one audit row with actor + before/after; delete attempt rejected
    - _Requirements: 6.1, 6.2, 5.9_

- [x] 17. Final Checkpoint — All tests pass
  - Ensure all backend and integration tests pass and the CI-equivalent commands are green locally; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the universal correctness properties (P1-P11) from the design document
- commission-system NEVER imports `OffersModule` or `CommissionService` and has no reverse dependency on any consumer - coupling is one-directional via the `COMMISSION_RATES` token (no circular dependency, no forwardRef)
- Two-moment resolution: Host fee at offer creation, Cleaner commission at match; each snapshot is immutable thereafter
- One rule = one side (`applies_to` HOST|CLEANER, single `rate_bps`); Host and Cleaner sides resolve independently
- The module resolves rates only; cents arithmetic stays in each consumer's own `CommissionService`
- Overlap of identical-scope active rules is prevented by a GiST exclusion constraint (concurrency-safe), not a plain unique index
- Commission rules are NEVER physically deleted; retirement is DEACTIVATE / past `effective_to`; audit FK is ON DELETE RESTRICT
- Subscriber tier comes only via the `SUBSCRIPTION_TIER` contract (FREE stub until Spec 11); the last-known-tier cache is owned by the subscription implementation, not here
- Distributed cache invalidation via Redis pub/sub so no API instance serves a stale commission rate after a write
- A business-policy per-side rate cap (configurable) rejects absurd rates at write time, distinct from the technical [0, 10000] bound
- No client-facing endpoint is added; the existing `GET /offers/:id/price-breakdown` serves snapshotted rates; previews are contract-internal and non-freezing
- Migrations `1700000015000` (rules) and `1700000016000` (audit) follow the last payments migration `1700000014000`
- Env VARIABLE names are `OFFER_HOST_FEE_RATE` / `OFFER_CLEANER_RATE`; TypeScript CONSTANTS are `OFFER_HOST_FEE_RATE_BPS` / `OFFER_CLEANER_RATE_BPS`, re-exported so defaults never diverge
- All configurable values come from environment variables, validated at startup (fail-fast)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["3.2", "4.1", "4.2", "4.3"] },
    { "id": 2, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 3, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 4, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 5, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["12.1", "12.2"] },
    { "id": 8, "tasks": ["13.1", "13.2"] },
    { "id": 9, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8", "15.9", "15.10", "15.11"] },
    { "id": 10, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7"] }
  ]
}
```









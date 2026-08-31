# Requirements Document

## Introduction

The commission-system decides **which commission rate applies** to each side of a service — the Host service fee and the Cleaner commission — and records the rule that produced each. Today the platform's 13% commission (10% Host service fee + 3% Cleaner commission) is a single pair of global rates read from environment variables (`OFFER_HOST_FEE_RATE`, `OFFER_CLEANER_RATE`) and applied identically to every offer. The BidClean plan requires two things that this flat model cannot express: **commissions configurable per country** (multi-country day 1: Colombia, USA, Canada, Europe) and a **commission discount for PRO subscribers** (e.g. a Cleaner PRO paying 1% instead of 3%).

This module introduces a **Commission Rate Resolver** exposed as the `COMMISSION_RATES` contract. Crucially, the two rates are resolved at **two different moments**, because they depend on actors known at different times: the **Host service fee is resolved at offer creation** (the Host exists) and the **Cleaner commission is resolved at match** (the winning Cleaner only exists once someone accepts). Each resolution selects the most-specific active **commission rule** for that side, falling back to the environment default when no rule matches. The resolved bps are handed to the CONSUMER module's own `CommissionService` for the cents arithmetic and snapshotted immutably (Host rate onto the offer at creation; Cleaner rate onto the winning proposal/offer at match). `stripe-escrow` reads those frozen snapshots and is unchanged.

This module owns **rate selection and rule configuration only**. It does NOT own the commission arithmetic (each consumer uses its own `CommissionService` — commission-system does not import it, avoiding any circular dependency), the money movement / escrow / payouts (owned by `stripe-escrow`), the subscription-tier source of truth or its last-known-tier cache (owned by the future `revenuecat-subscriptions`, consumed here via a contract), or commission reporting/analytics dashboards (owned by the data-engineering layer — Metabase over the read replica — per the plan).

## Domain Model Overview

```
COMMISSION RULE   (versioned, scoped, ONE side)
   scope: applies_to (HOST | CLEANER) + country (CHAR(2) | ANY) + subscriber_tier (FREE | PRO | ANY) + optional service_type
   value: rate_bps
   metadata: priority, effective_from, effective_to?, is_active
   audit:    created_by, updated_by, created_at, updated_at
        │
        │  resolveHostRate(ctx)     ── at OFFER CREATION (Host known) ──┐
        │  resolveCleanerRate(ctx)  ── at MATCH (winning Cleaner known) ┤  most-specific active rule per side wins
        ▼                                                              │
RESOLVED RATE (one side)  { rateBps, ruleId | null }  ─────────────────┘
        │
        │  consumer passes bps into ITS OWN
        ▼
CommissionService.getFullBreakdown(price, hostBps, cleanerBps)   (lives in the consumer, unchanged)
        │
        ▼
SNAPSHOT   Host rate -> offers (at creation) ; Cleaner rate -> winning proposal/offer (at match)
```

- A **Commission Rule** is a scoped, versioned record that sets exactly ONE rate side (`HOST` or `CLEANER`). Scope narrows by country, subscriber tier, and optionally service type. The resolver selects the single most-specific active rule for a given side + context; if none matches, it falls back to the environment default rate (so behavior is identical to today until rules are added). A HOST rule and a CLEANER rule are distinct records.
- **Resolution happens at TWO distinct moments, because the two rates depend on different actors known at different times:**
  - **Host service fee — resolved at offer creation.** The Host exists when the offer is created, so the Host rate is resolved against the Host's tier + country + service type and snapshotted immutably onto the offer (`host_service_fee_rate_bps`), exactly as today.
  - **Cleaner commission — resolved at match.** At offer creation there is no winning Cleaner yet (the offer is broadcast so Cleaners can discover it). The authoritative Cleaner rate therefore depends on the **winning Cleaner** and is resolved at the moment of match (direct accept / accepted proposal), against that Cleaner's tier + country + service type, and snapshotted onto the winning proposal / offer at match time. This is what makes the plan's promise real ("a Cleaner PRO pays a reduced commission on the jobs they win").
  - **Provisional Cleaner rate for previews:** before a match, radar/negotiation previews use a provisional Cleaner rate (the offer's current snapshot or the env default) purely for display; it is never authoritative and is superseded by the match-time resolution.
- **Once snapshotted, a rate is immutable.** The Host rate is frozen at creation; the Cleaner rate is frozen at match. Escrow reads the frozen values and never re-resolves. A later rule change never re-prices an existing offer.
- **Host and Cleaner rates are resolved independently**, each against its own actor's subscriber tier. A single matched offer can therefore combine a FREE-tier Host fee with a PRO-tier Cleaner commission.
- **Subscriber tier** (FREE/PRO) is not owned here. It is obtained through the `SUBSCRIPTION_TIER` contract; until `revenuecat-subscriptions` is implemented, a default stub reports FREE for every user, so PRO-discount rules simply never activate yet.
- **Currency is NOT a resolution dimension in v1.** Rates are basis points and currency-independent; the offer's country already implies its currency (CO→COP, US→USD, CA→CAD, EU→EUR, GB→GBP). Currency can be added as an explicit rule dimension later if a country ever needs per-currency rates, without reworking the resolver.

### Resolution Specificity (deterministic ordering)

A rule's **specificity score** is the count of its exactly-matched (non-`ANY`) dimensions:

```
specificity =  (country exact      ? +1 : 0)
             + (subscriber_tier exact ? +1 : 0)
             + (service_type exact  ? +1 : 0)
```

Among all active rules matching a context (per dimension, an `ANY` scope matches any value; an exact scope matches only its value), the winner is chosen strictly in this order:

```
1. highest specificity score
2. highest priority
3. latest effective_from
4. lowest UUID   (final, always-deterministic tie-break)
```

This guarantees resolution never depends on database row order. The Host rate and the Cleaner rate are each resolved by this same ordering, independently.

## Glossary

| Term | Definition |
|------|-----------|
| Commission | The platform's total take on a service: Host service fee (added on top of the price) + Cleaner commission (deducted from the price) |
| Host service fee | The amount added on top of the offered price and charged to the Host, expressed as a rate in basis points (`host_service_fee_rate_bps`) |
| Cleaner commission | The amount deducted from the offered price before payout to the Cleaner, expressed as a rate in basis points (`cleaner_commission_rate_bps`) |
| BPS (basis points) | Rate unit where 10000 bps = 100%; e.g. 1000 bps = 10%, 300 bps = 3% |
| Commission Rule | A versioned, scoped record that sets ONE rate side (`applies_to` = HOST or CLEANER) via a single `rate_bps` for a context (country, tier, optional service type) |
| Rule scope | The dimensions a rule matches on: `country` (ISO alpha-2 or ANY), `subscriber_tier` (FREE/PRO/ANY), optional `service_type`, plus `applies_to` (the side) |
| Resolver | The `CommissionRateResolver` service that selects the effective rate for one side + context |
| Effective rate | The `{ rateBps, ruleId }` produced by the resolver for one side + context |
| Environment default rates | The existing `OFFER_HOST_FEE_RATE` / `OFFER_CLEANER_RATE` env values (parsed into `OFFER_HOST_FEE_RATE_BPS` / `OFFER_CLEANER_RATE_BPS`), used as the fallback when no rule matches |
| Subscriber tier | Whether a user is FREE or PRO; sourced via the `SUBSCRIPTION_TIER` contract, not owned by this module |
| Host subscriber tier | The FREE/PRO tier of the offer's Host, resolved at offer creation for the Host service fee |
| Cleaner subscriber tier | The FREE/PRO tier of the winning Cleaner, resolved at match for the Cleaner commission |
| SubscriptionTierContract | The exposed backend contract (`SUBSCRIPTION_TIER` token) returning a user's tier; default stub returns FREE; owns the last-known-tier cache in its real impl |
| Specificity score | The count of a rule's exactly-matched (non-`ANY`) scope dimensions; higher = more specific |
| Last-known trusted tier | The most recent tier the SubscriptionTierContract successfully returned for a user, cached by the SubscriptionTierContract implementation and used as fallback when a fresh lookup is unavailable |
| CommissionService | The cents arithmetic service that lives in each CONSUMER module (`offer-publishing`, reused by `offer-negotiation`); commission-system does not own or import it |
| CommissionRateContract | The exposed backend contract (`COMMISSION_RATES` token) with `resolveHostRate` (consumed by offer-publishing at creation) and `resolveCleanerRate` (consumed by offer-negotiation at match) |
| Rate snapshot | The Host rate frozen onto `offers` at creation and the Cleaner rate frozen onto the winning proposal/offer at match; both immutable thereafter |
| Mobile_App | The React Native mobile application used by Hosts and Cleaners |

## Requirements

### Requirement 1: Commission Rate Resolution

**User Story:** As the platform, I want to resolve the correct commission rates for each offer from configurable rules, so that pricing can vary by country and subscriber tier without code changes.

#### Acceptance Criteria

1. WHEN the resolver is asked for ONE side's rate for a context (`applies_to`, country, that side's subscriber tier, service type), THE Resolver SHALL return an effective `rateBps` and the `ruleId` that produced it (null when the environment default was used). Currency is NOT part of the resolution context in v1. `resolveHostRate` resolves the `HOST` side; `resolveCleanerRate` resolves the `CLEANER` side.
2. WHEN more than one active rule matches a side + context, THE Resolver SHALL select the winner strictly by: (1) highest specificity score (count of exactly-matched non-`ANY` dimensions), then (2) highest priority, then (3) latest `effective_from`, then (4) lowest UUID as the final deterministic tie-break.
3. IF no active rule matches the side + context, THEN THE Resolver SHALL fall back to that side's environment default rate (`OFFER_HOST_FEE_RATE` for HOST, `OFFER_CLEANER_RATE` for CLEANER) and report a null rule id.
4. THE Resolver SHALL only consider rules that are active (`is_active = true`) and whose effective window contains the resolution time (`effective_from <= now < effective_to`, where a null `effective_to` means open-ended).
5. THE Resolver SHALL return rates as non-negative integer basis points suitable for direct use by the consumer's CommissionService.
6. THE Resolver SHALL be a pure selection over persisted rules and context; it SHALL NOT perform any money arithmetic itself.
7. THE Resolver SHALL resolve the Host side and the Cleaner side independently, each against the appropriate actor's subscriber tier and at its appropriate moment (Host at creation, Cleaner at match), applying the same specificity ordering to each.
8. WHERE two matching active rules have DIFFERENT scopes but equal specificity and overlapping effective windows, THE Resolver SHALL select deterministically via the tie-breaker in criterion 2 so resolution is never ambiguous. (Two rules with IDENTICAL scope and overlapping windows are prohibited at write time — see Requirement 5.)

### Requirement 2: PRO Subscriber Commission Discount

**User Story:** As a Cleaner PRO subscriber, I want a reduced commission on the jobs I win, so that my subscription pays for itself.

#### Acceptance Criteria

1. WHEN resolving the Host service fee at offer creation, THE Resolver SHALL obtain the Host's tier via the SubscriptionTierContract; WHEN resolving the Cleaner commission at match, THE Resolver SHALL obtain the winning Cleaner's tier via the SubscriptionTierContract. It SHALL never read a subscription store directly.
2. WHERE a PRO-scoped rule exists for the resolved side + context and the corresponding actor's tier is PRO, THE Resolver SHALL apply that rule in preference to an equivalent FREE/`ANY` rule (via the specificity ordering).
3. WHILE no `revenuecat-subscriptions` implementation is wired, THE SubscriptionTierContract default SHALL report FREE for every user, so PRO-scoped rules never activate and behavior matches the current flat model.
4. THE Resolver SHALL apply a `CLEANER`-side rule only to the Cleaner commission and a `HOST`-side rule only to the Host service fee, per the matched rule's value.
5. IF a fresh SubscriptionTierContract lookup is unavailable or errors, THEN THE Resolver SHALL use the actor's last-known trusted tier when one exists, and SHALL fall back to FREE only when no known value exists; in all cases it SHALL NOT fail offer creation or match. This is a conscious business decision to avoid charging a PRO actor a FREE-tier rate on a transient outage while still guaranteeing the flow never blocks. The last-known trusted tier is owned and cached by the SubscriptionTierContract implementation (`revenuecat-subscriptions`, Spec 11), NOT by commission-system.
6. THE SubscriptionTierContract lookup SHALL be bounded by a configurable timeout, after which the fallback in criterion 5 applies.

### Requirement 3: Per-Country Commission Configuration

**User Story:** As the platform operator, I want to set different commission rates per country, so that pricing complies with local market and regulation.

#### Acceptance Criteria

1. THE Resolver SHALL match a rule to a context by the offer's country when a country-scoped rule exists, in preference to an `ANY`-country rule.
2. THE commission rules SHALL support a country scope expressed as an ISO 3166-1 alpha-2 code, and an `ANY` sentinel meaning "all countries".
3. WHERE a country has no specific rule, THE Resolver SHALL use the applicable `ANY`-country rule, and if none exists, the environment default rates.
4. THE commission rules SHALL support the currencies used by the platform (COP, USD, CAD, EUR, GBP) implicitly through their country scope; rates are expressed in basis points and are currency-independent.

### Requirement 4: Commission Rate Contract (Host at creation, Cleaner at match)

**User Story:** As the offer-publishing and offer-negotiation modules, I want to obtain the effective commission rate for the side I own through a stable contract, so that each rate is resolved at the correct moment against the correct actor, without embedding rule logic and without any module depending on another module's concrete classes.

#### Acceptance Criteria

1. THE commission-system SHALL expose a CommissionRateContract (DI token `COMMISSION_RATES`) with two operations: `resolveHostRate(context)` (Host tier + country + service type) and `resolveCleanerRate(context)` (winning Cleaner tier + country + service type).
2. WHEN `offer-publishing` creates an offer, it SHALL call `resolveHostRate` and pass the resolved bps to its OWN `CommissionService.getFullBreakdown`, replacing the current no-argument call. commission-system SHALL NOT calculate cents and SHALL NOT depend on `CommissionService`.
3. WHEN `offer-negotiation` finalizes a match (direct accept or accepted proposal), it SHALL call `resolveCleanerRate` for the winning Cleaner and compute the authoritative Cleaner payout via its OWN `CommissionService`, then snapshot the resolved Cleaner rate onto the winning proposal / offer.
4. THE CommissionRateContract SHALL preserve current behavior when no rules are configured (env-default rates), so no existing offer or match flow changes until rules are added.
5. THE commission-system SHALL NOT write to the `offers`, negotiation, or payment tables; it only supplies rates. Each consuming module persists its own snapshot.
6. THE commission-system SHALL NOT implement any commission or rounding arithmetic; cents math stays in each consumer's `CommissionService`. There SHALL be no module-level dependency from commission-system to `offer-publishing` (no circular dependency); the coupling is one-directional via the `COMMISSION_RATES` token.
7. WHERE a consuming module cannot reach the contract, it SHALL fall back to the SAME environment default variables (`OFFER_HOST_FEE_RATE`, `OFFER_CLEANER_RATE`) — a single shared source of truth, never a second independent value that could diverge. Concretely, the consumer keeps its current env-default `getFullBreakdown` behavior as the fallback path.

### Requirement 5: Commission Rule Configuration Storage

**User Story:** As the platform, I want commission rules stored durably and auditably, so that rate changes are traceable and reversible.

#### Acceptance Criteria

1. THE commission-system SHALL persist commission rules in a dedicated table with UUID primary keys and `created_at`/`updated_at` timestamps.
2. THE commission rules SHALL store: country scope, subscriber-tier scope, optional service-type scope, `applies_to` (`HOST` | `CLEANER` — the rate side the rule sets), `rate_bps` (the single rate for that side), priority, `effective_from`, optional `effective_to`, and an `is_active` flag.
3. THE commission rules SHALL store rates as non-negative integer basis points (never floating point), consistent with the money-integrity standard.
4. THE commission-system SHALL prohibit two active rules with IDENTICAL scope (same `applies_to` + country + tier + service_type) and OVERLAPPING effective windows, enforced by a PostgreSQL exclusion constraint over the scope tuple and a `tstzrange(effective_from, effective_to, '[)')` (a plain unique index is insufficient because two rules with different `effective_from` can still overlap). The validated write path SHALL additionally serialize concurrent conflicting writes so two operators cannot both pass a pre-check and then both insert. (Rules with DIFFERENT scopes but equal specificity are permitted and resolved by the deterministic tie-breaker — see Requirement 1.)
5. THE commission-system SHALL default to the environment rates when the rules table is empty, guaranteeing backward-compatible behavior on first deploy.
6. THE commission rule migration SHALL be reversible (`up`/`down`) and SHALL use the next sequential migration timestamp after the existing payment tables migration (`> 1700000014000`).
7. THE commission rules SHALL support a future `effective_from`: a rule MAY be created in advance and SHALL NOT affect resolution until its `effective_from` is reached, enabling scheduled commission changes without a deploy.
8. THE commission-system SHALL record on every rule the actor who created it (`created_by`) and the actor who last modified it (`updated_by`).
9. THE commission-system SHALL NEVER physically delete a commission rule; retirement is expressed by DEACTIVATE (`is_active = false`) and/or an `effective_to` in the past, so the audit trail and historical resolution basis always survive. Consequently the audit table's FK to rules SHALL use `ON DELETE RESTRICT` (not `CASCADE`), guaranteeing audit history cannot be cascaded away.
10. THE commission-system SHALL enforce a configurable business-policy maximum on `rate_bps` per side (a cap distinct from the technical `[0, 10000]` bound), rejecting rules above the cap at write time; the cap value comes from configuration, never a literal in logic.

### Requirement 6: Commission Rule Change Audit

**User Story:** As a finance/compliance operator, I want a full history of who changed a commission rule, when, from what value to what value, and why, so that every rate change is traceable and defensible.

#### Acceptance Criteria

1. WHEN a commission rule is created, updated, activated, or deactivated, THE commission-system SHALL append an immutable audit record capturing the action (`CREATE`/`UPDATE`/`ACTIVATE`/`DEACTIVATE`), the acting user, the timestamp, the previous values, the new values, and an optional reason.
2. THE audit records SHALL be append-only and SHALL NOT be editable or deletable through the module's write paths.
3. THE audit record SHALL reference the affected rule by id and SHALL store rate values as integer basis points.
4. THE commission-system SHALL NOT require an audit reason to be non-empty, but SHALL persist it verbatim when provided.
5. THE audit storage SHALL be reversible via its migration (`up`/`down`).

### Requirement 7: Rate Transparency for Clients

**User Story:** As a Host or Cleaner, I want the price breakdown I see to reflect the actual rates that will apply, so that the numbers I see match what I pay or earn.

#### Acceptance Criteria

1. THE commission-system SHALL NOT introduce a new client-facing breakdown endpoint; the existing `GET /offers/:id/price-breakdown` continues to serve the snapshotted rates.
2. WHEN an offer is created (Host rate snapshotted) and WHEN it is matched (Cleaner rate snapshotted), THE breakdown returned by the existing offers/negotiation endpoints SHALL reflect those resolved rates, because they are snapshotted onto the offer / winning proposal.
3. THE Mobile_App SHALL continue to render the server-provided snapshotted breakdown and SHALL NOT compute rates client-side. Pre-match previews (radar/negotiation) MAY show a provisional Cleaner rate clearly understood as non-authoritative until match.
4. WHERE a preview of resolved rates before creation or match is needed, THE commission-system MAY expose read-only quote operations through the CommissionRateContract, returning effective rates for a context without persisting anything.
5. A preview is informational and SHALL NOT reserve or freeze a commission rate; only offer creation (Host) and match (Cleaner) perform authoritative resolution and create the immutable snapshots. A rule change between a preview and the authoritative moment MAY cause the snapshot to differ from the preview, and this is acceptable.

### Requirement 8: Configuration and Defaults

**User Story:** As an operator, I want all commission behavior configurable via environment and rules, so that nothing is hardcoded.

#### Acceptance Criteria

1. THE commission-system SHALL read the fallback default rates from the existing `OFFER_HOST_FEE_RATE` and `OFFER_CLEANER_RATE` environment variables (single source of truth for defaults; not duplicated). NOTE: the environment VARIABLE names are `OFFER_HOST_FEE_RATE` / `OFFER_CLEANER_RATE`; the parsed TypeScript CONSTANTS are `OFFER_HOST_FEE_RATE_BPS` / `OFFER_CLEANER_RATE_BPS`. This spec uses those names consistently and does not introduce a divergent variable.
2. THE commission-system SHALL validate at startup that any commission-specific configuration values it introduces are present and valid (fail-fast), consistent with existing modules.
3. THE commission-system SHALL NOT hardcode any rate, country, or tier value in logic; all such values come from environment or the rules table.
4. THE commission-system SHALL express the 13% model (1000 bps Host + 300 bps Cleaner) only as environment defaults, never as literals in code.

## Non-Functional Requirements

### Correctness Properties

- **P1 — Money integrity:** All rates are non-negative integer basis points; the module performs no floating-point arithmetic. Cents math is delegated to each consumer's `CommissionService` (commission-system itself never computes cents).
- **P2 — Deterministic resolution:** For a fixed set of rules and a fixed context, the resolver always returns the same effective rate and rule id per side, resolved by specificity → priority → `effective_from` → lowest UUID (no ambiguity).
- **P3 — Most-specific wins:** A higher specificity score (more exactly-matched non-`ANY` dimensions) always outranks a lower one, across country, tier, and service type.
- **P4 — Backward-compatible fallback:** With an empty rules table, resolution returns exactly the environment default rates, reproducing current behavior.
- **P5 — Snapshot immutability preserved:** The module never mutates an offer's or proposal's rate snapshot; the Host rate is frozen at creation, the Cleaner rate at match, and escrow reads the frozen values without re-resolving.
- **P6 — Tier isolation & safe degradation:** Subscriber tier is only obtained via the contract; the module holds no subscription data and degrades to last-known trusted tier (then FREE) safely on contract failure, never blocking creation or match. The last-known tier is owned by the subscription implementation, not by commission-system.
- **P7 — No double calculation & no circular dependency:** commission-system never reimplements fee/commission math or rounding and has no module-level dependency on `offer-publishing`; consumers reuse their own `CommissionService` and depend on commission-system only through the `COMMISSION_RATES` token.
- **P8 — Effective-window correctness:** Only rules active at resolution time (within `effective_from`/`effective_to`, future-dated rules excluded until their `effective_from`) are ever selected.
- **P9 — Independent host/cleaner resolution:** The Host fee rate and the Cleaner commission rate are resolved independently against their respective actors' subscriber tiers, at their respective moments; one matched offer may combine a FREE Host fee with a PRO Cleaner commission.
- **P10 — Audit completeness:** Every rule create/update/activate/deactivate produces an immutable audit record with actor, timestamp, and before/after values; rules are never physically deleted.
- **P11 — Rule-version / temporal correctness:** A rule mutation SHALL never alter the rate snapshot of an already-created or already-matched offer; a newly created offer resolves its Host rate against the ruleset effective at its creation timestamp, and a newly matched offer resolves its Cleaner rate against the ruleset effective at its match timestamp.

### Security
- Any administrative rule-management surface (if exposed) SHALL require authentication and an operator/admin authorization check; rule reads used internally by offer creation are server-to-server only.
- Administrative rule-management endpoints (if exposed) SHALL be rate-limited, consistent with other write endpoints in the platform.
- The module never exposes another user's subscription tier or private data to clients.
- All rule writes use parameterized queries; no rate value is ever interpolated as a string.
- Every rule mutation records the acting user in the audit trail (Requirement 6).

### Performance
- Rate resolution at offer creation (Host) and at match (Cleaner) SHALL each add no more than 20 ms p95 to their path, using an indexed rule lookup (or in-memory cached ruleset with bounded staleness).
- The subscriber-tier lookup SHALL be bounded by a configurable timeout, falling back to last-known trusted tier (then FREE), so it never blocks creation or match.

### Reliability
- Resolution SHALL never fail offer creation or match: any error in rule lookup or tier resolution degrades to environment default rates.
- The rules table SHALL be the durable source of truth; any in-memory cache SHALL reconcile to it with a configurable refresh AND SHALL be invalidated across all API instances on a rule write (distributed invalidation, e.g. Redis pub/sub), so no instance serves a stale commission rate after a change.

### Internationalization
- Commission rates are locale-independent (basis points); currency formatting of resulting amounts remains the responsibility of the existing offers/price-breakdown UI.
- No new user-facing strings are introduced by the core resolver; any admin UI text (if added) uses i18n keys.

## Dependencies

- **offer-publishing (Spec 6):** owns its `CommissionService` (used for cents arithmetic in ITS module), the `offers` table and the Host-rate snapshot column, and the offer-creation call site that consumes `resolveHostRate`. commission-system does NOT import `OffersModule` or `CommissionService` — the dependency is one-directional via the `COMMISSION_RATES` token to avoid any cycle.
- **offer-negotiation (Spec 8):** owns the match finalization (direct accept / accepted proposal) and the proposal payout snapshot; consumes `resolveCleanerRate` at match to freeze the winning Cleaner's rate. commission-system supplies the rate; negotiation performs the cents math with its own `CommissionService` and persists the snapshot.
- **revenuecat-subscriptions (Spec 11, future):** the real source of subscriber tier and the owner of the last-known trusted tier cache used for safe degradation, consumed here via the `SUBSCRIPTION_TIER` contract. Until then a default stub reports FREE. This module does NOT block on Spec 11.
- **Redis (existing):** transport for distributed cache invalidation of the ruleset across API instances on rule writes.
- **user-roles (Spec 2):** user/role resolution for admin rule-management authorization.
- **Data-engineering layer (Metabase + read replica):** consumes commission outcomes (`payments.net_platform_revenue_cents`) for reporting; commission-system does NOT provide analytics endpoints.

## Out of Scope

- Commission cent-level arithmetic and rounding (each consumer uses its own `CommissionService`; commission-system supplies rates only).
- Money movement: charging, escrow hold, payout, refunds, transfer reversals (owned by `stripe-escrow`).
- The subscription/entitlement system that determines PRO status and owns the last-known-tier cache (owned by `revenuecat-subscriptions`; consumed here via contract + stub).
- Commission/GMV reporting, dashboards, and analytics (owned by the data-engineering layer — Metabase over the PostgreSQL read replica — per the plan).
- Re-pricing or re-resolving rates for an already-created (Host) or already-matched (Cleaner) offer; snapshots are immutable and escrow reads them as-is.
- Any change to the negotiation deviation-bounds logic (owned by `offer-negotiation`); commission-system only supplies the Cleaner rate at match.
- Non-commission platform fees (e.g. cancellation penalties), which are separate business rules not covered here.

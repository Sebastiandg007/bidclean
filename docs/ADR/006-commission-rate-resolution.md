# ADR-006: Commission Rate Resolution as a Standalone Module

## Status
Accepted

## Context
BidClean charges a 13% commission (10% Host service fee added on top + 3% Cleaner commission
deducted). Until now those rates were a single global pair read from environment variables and
applied identically to every offer. The plan requires two things the flat model cannot express:
**commissions configurable per country** (multi-country day 1) and a **commission discount for
PRO subscribers** (e.g. a Cleaner PRO paying less than 3%).

The cents arithmetic already lives in `offer-publishing`'s `CommissionService`, and money
movement already lives in `stripe-escrow`. The open question was *where the decision of which
rate applies* should live, and *when* it should be made.

## Decision
We introduced a dedicated `commission-system` module that resolves **rate selection only**,
exposed through a single DI token (`COMMISSION_RATES`). Two consequential sub-decisions:

1. **Two-moment resolution.** The Host fee is resolved at **offer creation** (the Host exists),
   and the Cleaner commission is resolved at **match** (the winning Cleaner only exists once
   someone accepts). Each rate is snapshotted immutably at its moment.
2. **Token-only, one-directional coupling.** `commission-system` does not import `OffersModule`
   or `CommissionService`. Consumers depend on it solely through `COMMISSION_RATES` and keep
   doing their own cents math. There is no circular dependency and no `forwardRef`.

## Reasoning
- **Correct PRO semantics.** "A Cleaner PRO pays a reduced commission on the jobs they win"
  can only be honored if the Cleaner rate is resolved against the *winning* Cleaner — which is
  unknown at offer creation. Resolving at match makes the promise real.
- **Historical consistency.** Snapshotting each rate at its authoritative moment means a later
  rule change never re-prices an existing offer.
- **No duplication, no cycle.** Keeping arithmetic in the consumers and exposing only rates
  avoids reimplementing the money math and avoids `commission-system ↔ offer-publishing` import
  cycles.
- **Configurable without deploys.** Versioned rules with effective windows allow scheduled
  commission changes and per-country/per-tier configuration without code changes; an empty
  ruleset reproduces the exact previous flat behavior.
- **Safety first.** Rate resolution never blocks offer creation or match: any failure (no rule,
  DB error, subscription-tier timeout) degrades to the environment default rate.

## Rate Resolution Model
- One rule sets one side (`applies_to` = HOST | CLEANER) with a single `rate_bps`.
- Scope dimensions: country (ISO alpha-2 or ANY), subscriber tier (FREE/PRO/ANY), optional
  service type. NULL = ANY (wildcard).
- Winner ordering: specificity (count of exact non-ANY dimensions) → priority →
  latest `effective_from` → lowest UUID.
- Overlap of identical-scope active rules is prevented by a PostgreSQL GiST exclusion
  constraint over the scope tuple + `tstzrange(effective_from, effective_to, '[)')`.
- Subscriber tier is obtained via the `SUBSCRIPTION_TIER` contract (a FREE-returning stub
  until `revenuecat-subscriptions`, Spec 11).

## Alternatives Considered
- **Extend `offer-publishing` to hold rules.** Rejected: it would bloat that module and could
  not resolve the Cleaner rate at match without reaching back into negotiation.
- **Resolve both rates at creation against an "audience tier".** Rejected: the PRO discount
  would not reflect the actual winning Cleaner, breaking the business promise.
- **A reporting/ledger module.** Rejected as scope: GMV/commission dashboards belong to the
  data-engineering layer (Metabase over the read replica) per the plan; `net_platform_revenue`
  already lives on `payments`.
- **`forwardRef` to break the cycle.** Rejected: a token-only contract is cleaner and avoids
  the cycle entirely.

## Consequences
- `offer-publishing` and `offer-negotiation` each gain a dependency on the `COMMISSION_RATES`
  token; the Cleaner-rate snapshot on the winning proposal/offer is now written at match.
- A new `commission_rules` + `commission_rule_audit` schema (migrations `1700000015000`,
  `1700000016000`) must be applied. The GiST exclusion constraint requires the `btree_gist`
  extension.
- Multi-instance deployments require Redis pub/sub for cross-instance cache invalidation so no
  instance serves a stale rate after a change.
- Operator rule administration is gated by an allowlist of Keycloak subject ids until a formal
  admin role exists.
- The last-known-tier cache used for safe degradation is owned by `revenuecat-subscriptions`,
  not by this module.

# ADR-022: full-audit — live deployment-readiness, two-environment parity, report-not-patch

## Status

Accepted

> Note on numbering: the `full-audit` design.md refers to this record as "ADR-011",
> but ADR-011 is already taken by `011-revenuecat-shared-products-pricing.md`. This
> decision is therefore recorded as **ADR-022** (the next free number).

## Context

BidClean reaches go-live only after every feature is implemented (Specs 1–24),
correctness is verified (`quality-assurance-pbt`, Spec 25), and configuration is
inventoried + startup-valid (`secrets-inventory`). None of those proves the
**assembled, deployed system** is actually alive, wired, reachable, and functional
— first in local Docker, then on the VPS behind Traefik with real domains + SSL —
nor that the mobile app is store-submission-ready. Config-valid ≠ reachable ≠
healthy ≠ end-to-end-functional. The operator's ask is explicit: *validate every
component — backend, frontend, DevOps, engineering — that everything is well,
integrated, connected, and fully functional* before packaging and shipping.

A naive "ping every `/health`" audit would be dangerously misleading: a `200` on
`/health` is a liveness signal, not proof that an edge (Keycloak JWKS, MinIO
presign, AI `/verify-face`, Stripe) actually works. And "it works locally" is not
"it works on the VPS". We also must never let an automatic audit fire a real
financial transaction just to prove an integration is reachable.

## Decision

1. **Audit the LIVE assembled system; health ≠ integration.** Truth about
   up/reachable/healthy/connected comes from probing the running system, never
   re-derived from code/config. A health probe is a liveness signal ONLY and never
   satisfies an edge/integration item — the audit is not reducible to `GET /health`.

1b. **"Every component" is registry-defined.** Completeness is verified against a
   versioned component registry (`component-registry.yaml`) covering services AND
   internal modules (Nest modules, BullMQ workers, outbox/event consumers,
   scheduled jobs, webhook ingresses, AI endpoints, mobile feature modules). An
   event-driven entry declares the events it `consumes`/`produces`, and those
   declared events are exactly what the integration probe verifies fire end-to-end
   (not merely that a dependency is reachable).

1c. **The closed registry is reconciled against the owning specs / `ARCHITECTURE.md`
   before each audit** (manual review day-one, mirroring `secrets-inventory`). A
   divergence — a declared component missing from the registry, or an orphan
   registry entry — is a blocking `REGISTRY_STALE` finding, so the registry cannot
   silently drift. Reconciliation runs BEFORE the checklist is built, so Property 1
   (completeness) is defined over a verified-complete registry.

2. **Two-environment parity.** The same audit runs twice with the SAME invariants
   and environment-appropriate probes (localhost vs public subdomain). Each item
   separates its invariant (identical across environments) from its per-environment
   probe. Status is tri-state (`PASS | FAIL | N/A`); an `N/A` requires a non-empty
   justification; a mandatory+applicable item PASS locally but FAIL on the VPS is a
   blocking `PARITY_BREAK`. A probe that cannot run is `FAIL`, never a silent
   `N/A`/`PASS`.

3. **Three separated payment modes.** `sandbox` (automatic E2E, no real money, even
   on VPS), `live-readiness` (automatic non-transacting reachability/auth probe),
   and `operator-live-money` (a real transaction — MANUAL, operator-gated, NEVER in
   the automatic audit). `assertAutomaticModeAllowed` throws on `operator-live-money`,
   so the automatic audit can structurally never move real money.

4. **Report-and-gate, never patch.** Every RED item becomes a finding with
   `{ reason, invariantId, environment, evidence, owner }`, routed to its owner; the
   reporter mutates nothing. Readiness is ALL-mandatory+applicable-PASS-in-both-
   environments + justified `N/A` + valid store artifacts + no blocking finding. The
   operator executes the irreversible actions in order local-GREEN → VPS-GREEN →
   package → submit.

5. **Observability is modeled as telemetry/export edges**, not functional runtime
   dependencies of the API; Prometheus/Grafana/Loki/Sentry/Uptime Kuma are verified
   as "monitoring wired + receiving data" under `DEVOPS_SECURITY`.

**Clean boundaries:** `quality-assurance-pbt` owns code correctness (referenced,
never re-run); `secrets-inventory` owns config existence + secret handling, and a
`SECRET_EXPOSURE` is carried forward as a blocking finding (never remediated here).
No secret is ever printed, rotated, or emitted in evidence/findings/reports.

## Consequences

**Easier:**
- "Ready to ship" becomes a checkable checklist state, not an opinion.
- A missing/unwired component, a dead edge, or a local-only pass is caught before
  launch rather than discovered in production.
- The pure logic core (registry, reconciliation, builder, evaluator, reporter,
  payment policy, evidence builder) is property-tested (11 properties, fast-check,
  ≥100 iterations each), independent of the live stack.

**Harder / trade-offs:**
- The audit is operator-run per environment (the live VPS is not available to CI),
  not a PR gate; CI's own green-HEAD is instead one DevOps item the audit checks.
- The registry must be kept in sync with the specs/architecture (the reconciliation
  step enforces this, but it is real maintenance).
- "Operational-for-readiness" is a bounded, point-in-time bar (healthy + reachable +
  critical journeys functional at audit time) — it does NOT prove sustained
  production reliability; that remains ongoing monitoring's job (which the audit only
  verifies is wired).
- Phased delivery: Fase 1 ships the pure core + CLI + docs + property tests; the
  probes' execution against the running stack and the store builds are Fase 2
  operator steps, documented in the runbook.

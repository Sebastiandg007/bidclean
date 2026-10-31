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

## Fase 2 update — live health/presence probes wired to the running stack

The `service-health` and `component-presence` probes now issue REAL observations
against the running local stack when `FULL_AUDIT_LIVE_STACK=1`, instead of the
Fase-1 honest FAIL placeholder:

- HTTP liveness (`observeHealth`): a bounded `GET` (AbortController, 5s) to each
  component's resolved liveness URL — `api` `/health`, `ai` `/health/`, `keycloak`
  `/`, `minio` `/minio/health/live`, `centrifugo` `/health`, `libretranslate`
  `/languages`. Any transport failure synthesizes `httpStatus:0` ("down") so a probe
  never crashes the audit.
- TCP liveness (`observeTcp`): services with no HTTP surface (`postgres`, `redis`)
  are confirmed by a bounded TCP connect to their resolved host/port
  (`FULL_AUDIT_LOCAL_POSTGRES_PORT` / `FULL_AUDIT_LOCAL_REDIS_PORT`), reusing the
  same `HealthObservation` contract.
- Endpoints/ports are resolved from env vars with non-secret defaults in
  `config/targets.ts` + `probes/live-fetch.ts` — never hardcoded inside probe logic
  — preserving the "environment-appropriate probe" and secret-safe-evidence
  properties.

Measured against the live local stack, this took the `--env local` audit from 107
findings (all probes stubbed) to 37 — resolving every DEAD_EDGE / LIVE_JOURNEY /
DEVOPS placeholder plus all HTTP/TCP service health + presence. The remaining 37 are
honest: API-internal modules with no HTTP introspection route, VPS-only infra not run
locally (LiveKit, Whisper, Piper, Sentry, Prometheus/Grafana/Loki), and the
not-yet-built mobile store artifact.

## Fases 3–4 update — edge / external-integration / live-journey probes wired

The remaining three probe families now observe the live stack instead of their
placeholder:

- **inter-service-edge (Fase 3)** — `observeEdge` performs the REAL authenticated
  round-trip per edge: API→Keycloak fetches the realm JWKS and requires a non-empty
  `keys` array (the exact artifact the API validates tokens with); API→Centrifugo and
  mobile→Centrifugo hit the broker `/health`; API→Redis/BullMQ opens a TCP connection;
  API→AI (KYC / transcribe / verify-face) hits the AI `/health/`; mobile→API hits the
  API `/health`. An edge whose dependency is VPS-only (LiveKit) or purely in-process
  (outbox→push) fails honestly ("edge not locally verifiable") — never a fabricated
  PASS. Result: 15/18 internal edges GREEN against the live stack.
- **external-integration (Fase 4)** — `hasRealCredential` inspects only the SHAPE of
  the configured credential (dummy markers, or too-short placeholder) and reports
  "placeholder credential — set a real key on the VPS" instead of a false GREEN; a
  real credential triggers a non-transacting `live-readiness` reachability check. The
  credential value is never read into evidence. Stripe / RevenueCat / OneSignal /
  Bedrock / Mapbox are therefore honestly RED locally (all placeholders) and flip
  GREEN once real keys are set on the VPS — no code change needed.
- **live-journey (Fase 4)** — a journey/event-chain only runs honestly when its money
  prerequisite (a real Stripe sandbox credential) is present, since every core
  journey crosses escrow; until then it fails naming the missing prerequisite rather
  than fabricating a PASS.

Net: `--env local` reports 65 classified findings (vs the 37 when edge/integration/
journey were a single grouped placeholder) — the increase is honest granularity, not
regression. The pure interpreters (`interpretEdge` / `interpretIntegration` /
`interpretJourney`) and the no-real-money guard (Property 8) are untouched; `tsc`
EXIT 0, `jest` 7 suites / 32 tests EXIT 0. What stays RED locally is exactly what
needs the VPS + real credentials (Stripe/RevenueCat/OneSignal/Bedrock/Mapbox),
VPS-only infra (LiveKit/Whisper/Piper/Sentry/monitoring), the API-internal modules
with no HTTP introspection route, and the not-yet-built store artifact.

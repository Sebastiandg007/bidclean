# full-audit

## Purpose

Tooling for the `full-audit` (deployment-readiness) meta-spec — the platform's **final gate before go-live**. It verifies that the whole assembled BidClean system (NestJS API, FastAPI AI service, Expo mobile app, and all self-hosted infrastructure) is **present, wired, reachable, healthy, and end-to-end functional** against the *running* system, first in **local Docker**, then on the **VPS behind Traefik with real domains + SSL**, and that the mobile app is **store-submission-ready**. It is a tooling + documentation artifact — not a NestJS module or a mobile screen — and it introduces no database entities and no runtime product behavior.

It runs after every feature is implemented (Specs 1–24), correctness is verified (`quality-assurance-pbt`, Spec 25), and configuration is inventoried + startup-valid (`secrets-inventory`). It **observes, verifies, reports, and gates**; it never patches behavior/config, never invents config, never re-runs Spec 25's suites, never rotates secrets, and never auto-triggers real money.

## Authority chain (the design's spine)

One-directional — the **running deployment is the subject under audit**; truth comes from probing the live system, never from re-reading code/config:

```
COMPONENT REGISTRY  →  PROBES (against the RUNNING system)  →  READINESS CHECKLIST  →  READINESS VERDICT
```

- **The component registry** (`registry/component-registry.yaml`) is authoritative for "what must exist and be wired" — services AND internal modules (Nest modules, BullMQ workers, outbox/event consumers, scheduled jobs, webhook ingresses, AI endpoints, mobile feature modules). A component is "real" only because the registry declares it.
- **Probes** are authoritative for "is it actually alive/reachable/functional." A health `200` is a **liveness signal only** — never integration proof. The audit **never reduces to `GET /health`**.
- **The readiness checklist** is the single auditable artifact — "ready to ship" is a checklist *state*, not an opinion.
- **Owning specs** remain the source of truth for behavior + config + correctness; a discrepancy is a **finding routed to the owner**, never fixed here.

## Files

| File | Responsibility |
|------|---------------|
| `registry/component-registry.ts` | Types: `ComponentEntry`, `Surface`, `RequiredInEnvironment`, `ProbeRef`, `EventRef`. `consumes`/`produces` are exactly what the `integrationProbe` verifies for an event-driven entry. |
| `registry/component-registry.yaml` | The versioned registry — services/infra + internal modules, with real event name strings. |
| `registry/registry-loader.ts` | Parses the YAML into `ComponentEntry[]`; **fails loudly** on any malformed/duplicate entry (never a partial registry). |
| `registry/declared-components.ts` | The operator-maintained declared-component set (the registry's source of truth — day-one a documented manual review against the specs / ARCHITECTURE). |
| `registry/registry-reconcile.ts` | PURE reconciliation: any divergence (declared-but-missing, or orphan registry entry) → a blocking `REGISTRY_STALE` finding. Runs BEFORE the checklist is built. |
| `checklist/checklist.model.ts` | Core types: `Environment`, tri-state `Status`, `CheckCategory` (×7), `Invariant`, `Probe`, `ProbeResult`, `ChecklistItem`, `FindingReason`, `Finding`, `Verdict`, `ReadinessReport`. |
| `checklist/checklist.builder.ts` | For EVERY registry entry builds a presence + an integration item with a defined probe and an owner; event-driven entries' integration item targets their declared events; env-only items are `N/A` with a justification. |
| `payment/payment-modes.ts` | The three separated modes; `assertAutomaticModeAllowed` throws on `operator-live-money`. |
| `probes/probe.types.ts` | The `Probe` contract + the shared, secret-safe evidence builder (structurally never embeds a secret value). |
| `probes/component-presence.probe.ts` | Required service/module present + up; missing → `FAIL` (`MISSING_OR_DOWN`); no native health endpoint → a minimal liveness probe, never "assume up". |
| `probes/service-health.probe.ts` | Health/readiness GREEN — **LIVENESS ONLY**, evidence always carries the liveness-only marker; never satisfies an edge item. |
| `probes/inter-service-edge.probe.ts` | A real authenticated call; PASS requires reachable **AND** authenticated **AND** completed; configured-but-dead → `FAIL` (`DEAD_EDGE`). |
| `probes/external-integration.probe.ts` | Stripe/RevenueCat/OneSignal/Bedrock/Mapbox via the payment-mode policy — no real money in a test. |
| `probes/live-journey.probe.ts` | Spec 25 journeys A–E + favorites-first against the running system; failure → `LIVE_JOURNEY_FAILED`. |
| `probes/store-readiness.probe.ts` | AAB/IPA + Galaxy + artifacts (icon, unfolded screenshots, listing, rating, privacy, reviewer path); missing → `INVALID_STORE_ARTIFACT`. |
| `probes/devops-security.probe.ts` | Traefik SSL, monitoring wired, recent readable backup, green-HEAD CI, TLS, secrets server-side, carried `SECRET_EXPOSURE`; misconfig → `DEVOPS_MISCONFIGURED`. |
| `probes/index.ts` | The probe registry (`probeType` → runnable `Probe`). |
| `evaluate/readiness-evaluator.ts` | PURE: both environments' states + store flag + carried findings → verdict + parity + N/A validation. |
| `evaluate/findings-reporter.ts` | PURE: one finding per violating condition, non-empty owner, mutates nothing. |
| `config/targets.ts` | Per-environment target resolution from env vars (no hardcoded endpoints in probe logic). |
| `audit.ts` | Orchestration: reconcile → build → probe → record for one environment. |
| `audit.cli.ts` | Entry point `audit --env local\|vps`: reconcile first (block on stale), probe, serialize reports, refresh the human checklist. |
| `reports/render-checklist.ts` | Renders the checklist + findings + verdict into `docs/deployment/READINESS-CHECKLIST.md`. |

### Tests (`__tests__/`)

The 11 correctness properties map one-to-one to property-based suites (fast-check, ≥100 iterations, tagged `// Feature: full-audit, Property {n}: …`), plus example-based unit tests:

| File | Covers |
|------|--------|
| `arbitraries.ts` | Shared fast-check arbitraries (registries, declared sets, checklists with per-env tri-state). |
| `checklist-builder.property.spec.ts` | **Property 1** (registry→checklist completeness) + builder examples. |
| `probes.property.spec.ts` | **Property 2** (health ≠ integration), **7** (no secret in evidence), **10** (reachable+auth ≠ configured). |
| `evaluator-reporter.property.spec.ts` | **Property 3** (tri-state), **4** (parity), **5** (verdict equivalence), **6** (findings routed, no-patch), **9** (SECRET_EXPOSURE blocking). |
| `payment-modes.property.spec.ts` | **Property 8** (no real money auto-triggered) + examples. |
| `registry-reconcile.property.spec.ts` | **Property 11** (registry reconciliation) + examples. |
| `registry-loader.spec.ts` | Loader unit tests (well-formed parses, malformed fails loudly, real artifact loads). |
| `evaluator-reporter.examples.spec.ts` | Evaluator edges + findings routing examples. |

## The seven probe types (and why health ≠ integration)

| Probe | What it proves |
|---|---|
| `component-presence` | the required service/module is there and up (per environment) |
| `service-health` | a liveness/readiness signal is GREEN — **nothing more** |
| `inter-service-edge` | an edge is actually reachable **and authenticated** (a completed call) |
| `external-integration` | an external integration is reachable per environment, no real money |
| `live-journey` | the critical E2E journeys pass against real services |
| `store-readiness` | the app builds + every submission artifact is present and valid |
| `devops-security` | SSL, monitoring, backups, CI, TLS, secrets server-side |

A `SERVICE_HEALTH` PASS never by itself satisfies an `INTER_SERVICE_EDGE` / `EXTERNAL_INTEGRATION` item — the evaluator and the probe types enforce this (Property 2).

## Two-environment discipline

The same audit runs **twice with the same invariants** but environment-appropriate probes: (1) LOCAL (Docker on the dev machine), then (2) VPS (same stack behind Traefik with real domains + SSL). Each item's *invariant* is identical; its *probe* may differ. A mandatory+applicable item PASS locally but FAIL on the VPS is a blocking `PARITY_BREAK`. Environment-only items are `N/A` with a justification — never forced GREEN, never silently skipped.

## The three payment modes (money never auto-triggered)

- **sandbox** — the automatic readiness E2E (no real money, even on VPS).
- **live-readiness** — automatic non-transacting reachability/auth probes.
- **operator-live-money** — a real transaction: MANUAL, operator-gated, **never** part of the automatic audit (`assertAutomaticModeAllowed` throws on it).

## Readiness gate ordering

`reconcile registry → local audit GREEN → deploy to VPS → VPS audit GREEN → package mobile → submit`. full-audit **declares** readiness; the operator **executes** the irreversible actions. See `docs/deployment/READINESS-RUNBOOK.md`.

## Clean boundaries with neighbors

- **`quality-assurance-pbt` (Spec 25)** — owns code correctness. full-audit **references** its green result; it **never re-runs** the suites.
- **`secrets-inventory`** — owns config existence + startup-validity + secret handling. full-audit assumes config is filled and **carries forward** any `SECRET_EXPOSURE` as a **blocking** finding; it **never rotates/remediates** a secret.

## Fase 1 vs Fase 2

This is **Fase 1**: the pure core (registry, reconciliation, builder, payment policy, probe contracts/interpretation, evaluator, reporter), the CLI, the 11 property tests + unit tests, and the docs. The probes' interpretation logic is complete and tested with simulated inputs. Because the live stack is not up in Fase 1 (`FULL_AUDIT_LIVE_STACK` unset), every edge/integration/journey/store/devops probe returns an honest **FAIL** ("target unreachable — Fase 2") rather than a silent `N/A`/`PASS`, so the CLI runs today and produces an honest `NOT_READY` report whose FAILs are exactly the ones **Fase 2** must turn green by bringing up the stack (local, then VPS) and packaging the mobile artifacts. The integration tests against the running stack and the store builds (tasks 11.2–11.5) are the operator's Fase-2 steps, documented in the runbook.

## How to Run

From the repo root (PowerShell on Windows — use `;`, not `&&`):

```powershell
# Type-check the tool in isolation
npx tsc --noEmit -p tools/full-audit/tsconfig.json

# Run the unit + property tests (11 properties, >=100 iterations each)
npx jest --config tools/full-audit/jest.config.js

# Run a local audit (Fase 1: honest NOT_READY; use -T to transpile-only)
npx ts-node -T --project tools/full-audit/tsconfig.json tools/full-audit/audit.cli.ts --env local

# Fase 2 (operator, once the stack is up):
#   $env:FULL_AUDIT_LIVE_STACK = "1"
#   ... --env local   then   ... --env vps
```

Generated reports are written under `tools/full-audit/reports/` (git-ignored) and the human checklist to `docs/deployment/READINESS-CHECKLIST.md`.

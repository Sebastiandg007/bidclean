# Implementation Plan: Full Audit (Deployment-Readiness)

## Overview

`full-audit` is the platform's **final gate before go-live** — a meta / operational spec, not a product feature. It ships no user-facing runtime behavior, adds no database tables, and re-runs no unit/property suite. It verifies the **live, assembled system** (backend, AI, mobile, infra) is present, wired, reachable, healthy, and end-to-end functional, first in **local Docker** then on the **VPS behind Traefik**, and confirms the mobile app is **store-submission-ready**.

Implementation lives under `tools/full-audit/` (tooling + docs, NOT a NestJS module or mobile screen) and produces committed docs + machine-readable reports. It is built bottom-up along the authority chain: **component registry → registry reconciliation → checklist model + builder → payment-mode policy → the seven probe families → the pure readiness-evaluator + findings-reporter → the audit CLI + report serialization**, then property tests (fast-check, the repo's established PBT choice) for the 11 correctness properties, example-based unit tests, integration tests against the running stack (local then VPS), store build/readiness checks, and finally the documentation deliverables.

The design's spine is one-directional: `COMPONENT REGISTRY → PROBES (against the RUNNING system) → READINESS CHECKLIST → READINESS VERDICT`. A health `200` is a **liveness signal only**, never integration proof (the audit never reduces to `GET /health`). full-audit **observes, verifies, reports, and gates**; it never patches behavior/config, never invents config (that is `secrets-inventory`), never re-runs Spec 25's suites (references them), never rotates secrets, and never auto-triggers real money. The operator executes the irreversible actions in the order local-GREEN → VPS-GREEN → package → submit.

## Tasks

- [ ] 1. Tooling scaffold and shared foundations
  - [ ] 1.1 Set up the `tools/full-audit/` structure and test wiring
    - Create the directory skeleton per the design: `registry/`, `checklist/`, `probes/`, `payment/`, `evaluate/`, `reports/`, plus `audit.cli.ts`
    - Add the fast-check dev dependency wiring for this tool's tests (reuse the repo's established fast-check setup as in `secrets-inventory` / `quality-assurance-pbt` — do NOT implement PBT from scratch)
    - Add a `tools/full-audit/README.md` stub to be filled in task 12.1
    - _Requirements: 8.5_

- [ ] 2. Component registry (the checkable definition of "every component")
  - [ ] 2.1 Implement the registry types (`registry/component-registry.ts`)
    - Define `Surface` (`API|AI|MOBILE|INFRA`), `RequiredInEnvironment` (`local|vps|both`), `ProbeRef` (with `probeType` union covering the seven probe types + `probeId`), `EventRef` (`eventName`, optional `channel`)
    - Define `ComponentEntry` with `componentId`, `owner`, `surface`, `entryPoint`, `dependencies`, optional `consumes`/`produces` (`EventRef[]`), `requiredInEnvironment`, `healthProbe` (liveness signal, NOT integration proof), `integrationProbe` (wired-into-the-system proof)
    - Document via JSDoc that `consumes`/`produces` are exactly what the `integrationProbe` verifies for event-driven entries
    - _Requirements: 3.1_
  - [ ] 2.2 Author the versioned registry source artifact (`registry/component-registry.yaml`)
    - Enumerate services + infra from the audited-topology diagram: API, AI, mobile build, Postgres+PostGIS, Redis, MinIO, Keycloak, Centrifugo, LiveKit, LibreTranslate, Whisper, Piper, Traefik, Prometheus/Grafana/Loki, Sentry, Uptime Kuma
    - Enumerate internal modules that can be "up but unwired": Nest modules, BullMQ workers, outbox/event consumers, scheduled jobs, webhook ingresses (Stripe/RevenueCat/OneSignal/LiveKit), AI endpoints (`/transcribe`, `/verify-face`), mobile feature modules, notification consumers
    - For event-driven entries, declare `consumes`/`produces` (e.g. `offer.matched`, `service_arrived`, `checklist_completed`, dispute routing, `outbox.push`); set `owner` and `requiredInEnvironment` per entry
    - Implement a loader that parses the YAML into `ComponentEntry[]` and fails loudly on malformed entries
    - _Requirements: 1.1, 3.1, 3.5_
  - [ ]* 2.3 Write unit tests for the registry loader
    - A well-formed YAML parses into the expected `ComponentEntry[]` with events preserved; a malformed entry fails loudly (never a partial/silent registry)
    - _Requirements: 3.1_

- [ ] 3. Checklist model and finding types (`checklist/checklist.model.ts`)
  - [ ] 3.1 Implement the checklist and readiness types
    - Define `Environment` (`local|vps`), `Status` tri-state (`PASS|FAIL|N/A`), `CheckCategory` (the 7 categories), `Invariant` (env-independent), `Probe` (per-environment, `probeRef`+`environment`+`target`), `ProbeResult` (`status`, `evidence` — NEVER a secret value, `observedAt`)
    - Define `ChecklistItem` (invariant, owner, mandatory, per-environment `probes` — null iff N/A, per-environment `results`, per-environment `applicabilityJustification`)
    - Define `FindingReason` union including `MISSING_OR_DOWN`, `DEAD_EDGE`, `UNWIRED_COMPONENT`, `CHAIN_NOT_FIRING`, `REGISTRY_STALE`, `LIVE_JOURNEY_FAILED`, `PARITY_BREAK`, `UNJUSTIFIED_NA`, `INVALID_STORE_ARTIFACT`, `DEVOPS_MISCONFIGURED`, `SECRET_EXPOSURE`; `Finding` (`reason`, `invariantId`, `environment|'both'`, `evidence`, `owner`, `blocking`); `Verdict` (`READY|NOT_READY`); `ReadinessReport`
    - _Requirements: 1.5, 2.5, 8.1, 8.2_

- [ ] 4. Registry reconciliation (the closed registry cannot silently drift)
  - [ ] 4.1 Implement the reconciliation comparison (`registry/registry-reconcile.ts`)
    - Pure function comparing the registry against a declared-component set (from owning specs / `ARCHITECTURE.md` topology): a spec/architecture component missing from the registry, or a registry entry with no owning declaration, each yields a blocking `REGISTRY_STALE` finding routed to the owner
    - A fully reconciled registry (every declared component present, no orphans) yields no `REGISTRY_STALE` finding
    - Document that day-one this consumes an operator-maintained declared-component set (manual review), MAY later be automated; it runs BEFORE the checklist is built
    - _Requirements: 3.1, 3.5_
  - [ ]* 4.2 Write property + unit tests for reconciliation
    - **Property 11: Registry reconciliation (the closed registry cannot silently drift)**
    - **Validates: Requirements 3.1, 3.5**
    - fast-check over arbitrary registry-vs-declared pairs (overlapping/missing/orphaned); min 100 iterations; tag `// Feature: full-audit, Property 11: ...`
    - Example unit tests: matching set → no finding; missing declared component and orphan entry each → blocking `REGISTRY_STALE` routed to owner
    - _Requirements: 3.1, 3.5_

- [ ] 5. Checklist builder (`checklist/checklist.builder.ts`)
  - [ ] 5.1 Implement the builder over the reconciled registry + catalogs
    - For EVERY registry entry, produce both a component-presence checklist item and an integration checklist item, each referencing a defined non-trivial probe (a component with no native health endpoint still gets a minimal liveness probe — never "assume up"); every item carries an owner
    - For event-driven entries (declaring `consumes`/`produces`), the integration item's probe targets those declared events firing — dependency reachability alone never satisfies an event-driven entry
    - Fold in the integration/journey/store/devops catalogs to add `INTER_SERVICE_EDGE`, `EXTERNAL_INTEGRATION`, `LIVE_JOURNEY`, `STORE_READINESS`, `DEVOPS_SECURITY` items with per-environment probes and `N/A` (+ justification) for environment-only items
    - Builder runs only after reconciliation passes (guards Property 1's completeness over a verified-complete registry)
    - _Requirements: 1.1, 1.4, 3.1, 3.2, 3.5_
  - [ ]* 5.2 Write property + unit tests for the builder
    - **Property 1: Registry→checklist completeness (every component, no silent drop)**
    - **Validates: Requirements 1.1, 1.4, 3.1, 3.2, 3.5**
    - fast-check over arbitrary registries (varied surfaces, entries with/without native health endpoints, event-driven entries with arbitrary `consumes`/`produces`); assert every entry yields presence + integration items with defined probes and owners, and event-driven entries' integration probe targets declared events; min 100 iterations; tag `// Feature: full-audit, Property 1: ...`
    - Example unit tests: fixed small registry → expected items; no-native-health entry → minimal liveness probe; event-driven entry → integration probe on declared events (not just dependency reachability)
    - _Requirements: 1.1, 1.4, 3.1, 3.2_

- [ ] 6. Checkpoint — registry, model, reconciliation, and builder compile and tests pass
  - Ensure the registry types + loader, checklist model, reconciliation, and builder compile and their tests pass. Ask the user if questions arise.

- [ ] 7. Payment-mode policy (`payment/payment-modes.ts`)
  - [ ] 7.1 Implement the three separated payment modes
    - Define `PaymentMode` (`sandbox | live-readiness | operator-live-money`) and `assertAutomaticModeAllowed(mode)` that permits `sandbox`/`live-readiness` and THROWS on `operator-live-money` — a real transaction is only an explicit operator action outside the automatic audit
    - _Requirements: 2.4, 4.2_
  - [ ]* 7.2 Write property + unit tests for the payment-mode policy
    - **Property 8: The automatic audit can never move real money**
    - **Validates: Requirements 2.4, 4.2**
    - fast-check over all mode values; assert only `sandbox`/`live-readiness` pass and `operator-live-money` is refused; min 100 iterations; tag `// Feature: full-audit, Property 8: ...`
    - Example unit test: `assertAutomaticModeAllowed` permits sandbox/live-readiness, throws on operator-live-money
    - _Requirements: 2.4, 4.2_

- [ ] 8. Probe library (`probes/*.probe.ts`) — evidence from the RUNNING system, no secret values
  - [ ] 8.1 Define the probe contract and shared evidence helper
    - Create the `ProbeContext` (`environment`, resolved `targets`) and `Probe` function type in `probes/probe.types.ts`
    - Implement a shared evidence-builder that records outcome by name/outcome only (e.g. "authenticated", "JWKS valid") and structurally never embeds a secret value
    - _Requirements: 2.2, 7.3_
  - [ ] 8.2 Implement `component-presence.probe` and `service-health.probe`
    - `component-presence`: required service/module exists + is up per environment; missing required → `FAIL` (`MISSING_OR_DOWN`); no native health endpoint → a defined minimal liveness probe, never an "assume up"
    - `service-health`: probes a health/readiness (or minimal liveness) endpoint, requires GREEN, and its evidence explicitly records this is a LIVENESS signal, not edge proof (never reduces a component to `GET /health`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [ ] 8.3 Implement `inter-service-edge.probe`
    - Performs a real authenticated call across each edge (Keycloak token+JWKS validate, Centrifugo publish, LiveKit token mint + webhook ingress, MinIO presign+fetch, API→AI `/transcribe`+`/verify-face`, Postgres/Redis connect), confirming the configured credential actually authenticates WITHOUT printing/rotating the secret
    - Configured-but-dead → `FAIL` (`DEAD_EDGE`); a `PASS` requires evidence of an actually-completed authenticated call
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 8.4 Implement `external-integration.probe`
    - Exercises the environment's configured integration (sandbox or live) for Stripe/RevenueCat/OneSignal/Bedrock and mobile→Mapbox, using the payment-mode policy so no real money moves in a test
    - _Requirements: 2.1, 2.4_
  - [ ] 8.5 Implement `live-journey.probe`
    - Runs Spec 25's critical journeys (A–E + favorites-first) against the RUNNING assembled system (real services, not mocks), both Host and Cleaner roles, full lifecycle + dispute + subscription; money touches use `sandbox` only; failure → `FAIL` (`LIVE_JOURNEY_FAILED`)
    - _Requirements: 4.1, 4.2, 4.4_
  - [ ] 8.6 Implement `store-readiness.probe`
    - Confirms the single Expo codebase builds Android AAB (Play + Galaxy) + iOS build to current store technical requirements, and that artifacts are present + valid: icon 1024×1024, screenshots incl. unfolded/large-screen (samsung-optimization), listing metadata, content rating, privacy link, and a concrete reviewer test path with credentials referenced WITHOUT committing them to the repo; missing/invalid → `INVALID_STORE_ARTIFACT`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 8.7 Implement `devops-security.probe`
    - Verifies Traefik SSL (valid certs) on all subdomains, monitoring stack wired + receiving data, backups configured + a recent successful artifact exists and is readable, CI green on HEAD running the intended suites, TLS in transit, secrets server/infra-side (no secret in client bundle), and any carried-forward `SECRET_EXPOSURE` surfaced as blocking; misconfiguration → `DEVOPS_MISCONFIGURED`
    - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - [ ]* 8.8 Write property + unit tests for probe evidence and edge/liveness distinction
    - **Property 2: Health is liveness only — never integration proof**
    - **Validates: Requirements 1.2, 2.1**
    - **Property 7: No secret is ever emitted in evidence or findings**
    - **Validates: Requirements 2.2, 6.3, 7.3**
    - **Property 10: Reachable-and-authenticated edge invariant is distinct from configured**
    - **Validates: Requirements 2.1, 2.3**
    - fast-check: an `INTER_SERVICE_EDGE`/`EXTERNAL_INTEGRATION` item is `PASS` only when its own edge probe passed (a `SERVICE_HEALTH` PASS never satisfies it); synthetic evidence/finding strings seeded with/without secret-shaped substrings never leak; a merely-configured edge resolves to `FAIL` (`DEAD_EDGE`), never `PASS`; min 100 iterations each; tag each `// Feature: full-audit, Property {2|7|10}: ...`
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 6.3, 7.3_

- [ ] 9. Readiness evaluator and findings reporter (pure aggregation)
  - [ ] 9.1 Implement the readiness evaluator (`evaluate/readiness-evaluator.ts`)
    - PURE `evaluateReadiness(input)` over both environments' checklist states + `storeArtifactsValid`: `READY` iff every mandatory item is `PASS` in every environment where applicable, every `N/A` is justified, no parity break, and store artifacts valid
    - Emit `PARITY_BREAK` for a mandatory+applicable local-PASS/VPS-FAIL; emit `UNJUSTIFIED_NA` for an unjustified `N/A` on a mandatory item; a probe that could not run is `FAIL`, never silently `N/A`/`PASS`; carried-forward `SECRET_EXPOSURE` is surfaced as blocking → `NOT_READY`
    - Enforce tri-state integrity: status ∈ `{PASS,FAIL,N/A}`, `N/A` never counted as `PASS`; invariant is a single env-independent value while probes are keyed per environment
    - _Requirements: 1.3, 2.3, 3.3, 4.3, 4.5, 5.1, 5.3, 5.5, 6.5, 7.3, 7.4, 8.2_
  - [ ] 9.2 Implement the findings reporter (`evaluate/findings-reporter.ts`)
    - PURE `reportFindings(report)`: exactly one finding per violating condition (no violation silently dropped), each carrying `{ invariantId, environment, evidence, owner }` with non-empty owner; MUTATES NONE of its inputs (deep-equal before/after) — reports and routes, never patches
    - _Requirements: 8.1, 8.3_
  - [ ]* 9.3 Write property + unit tests for the evaluator and reporter
    - **Property 3: Tri-state integrity and mandatory N/A justification** — **Validates: Requirements 1.5, 2.5, 5.3, 8.2**
    - **Property 4: Two-environment parity (same invariant, per-environment probe; disagreement blocks)** — **Validates: Requirements 4.5, 5.1, 5.3, 7.5**
    - **Property 5: Readiness verdict equivalence** — **Validates: Requirements 1.3, 2.3, 3.3, 4.3, 5.5, 6.5, 7.4, 8.2**
    - **Property 6: Findings are routed, complete, and never patch** — **Validates: Requirements 8.1, 8.3**
    - **Property 9: Carried-forward SECRET_EXPOSURE is always blocking** — **Validates: Requirements 7.3**
    - fast-check over arbitrary checklists (independent per-environment tri-state statuses, mandatory flags, justified/unjustified `N/A`, applicable/inapplicable-per-environment items) + inputs carrying/not-carrying `SECRET_EXPOSURE`; for Property 6 assert inputs deep-equal before/after (purity); min 100 iterations each; tag each `// Feature: full-audit, Property {3|4|5|6|9}: ...`
    - Example unit tests: all-PASS both envs + valid store → `READY`; one mandatory `FAIL` → `NOT_READY`; justified `N/A` on a VPS-only item in local → still `READY`; unjustified `N/A` on mandatory → finding; `DEAD_EDGE` on API→Keycloak routes to auth owner; `INVALID_STORE_ARTIFACT` routes to mobile-build owner
    - _Requirements: 1.3, 1.5, 2.3, 2.5, 3.3, 4.3, 4.5, 5.1, 5.3, 5.5, 6.5, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3_

- [ ] 10. Checkpoint — pure core (payment policy, probes, evaluator, reporter) compiles and property tests pass
  - Ensure the payment-mode policy, probe library, evaluator, and reporter compile and Properties 1–11's property tests pass. Ask the user if questions arise.

- [ ] 11. Audit CLI, report serialization, and integration/build wiring
  - [ ] 11.1 Implement the audit CLI (`audit.cli.ts`) and report serialization
    - `audit --env local|vps`: reconcile the registry first (block on `REGISTRY_STALE`), build the checklist, run every applicable probe for that environment, record results; when both environment reports exist, invoke the evaluator + reporter
    - Serialize `reports/readiness-report.{local,vps}.json` and `reports/findings.json`, and refresh the human `docs/deployment/READINESS-CHECKLIST.md`
    - _Requirements: 5.1, 8.1, 8.4_
  - [ ]* 11.2 Write integration tests against the running stack — component presence, health, edges, external integrations (local, then VPS)
    - Each registry service answers its liveness probe GREEN; a real authenticated call succeeds on each edge (Keycloak JWKS, Centrifugo publish, LiveKit token+webhook, MinIO presign+fetch, AI `/transcribe`+`/verify-face`, Postgres/Redis) with no secret printed; Stripe/RevenueCat/OneSignal/Bedrock reachable via the environment's configured mode; mobile→Mapbox reachable — no real money. 1–3 runs per environment
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.4_
  - [ ]* 11.3 Write integration tests for durable event chains and live journeys against the running system
    - `offer.matched`→escrow charge, `service_arrived`→video-verification, `checklist_completed`→completion, dispute routing→escrow action, outbox→push each fire end-to-end; Spec 25 journeys A–E + favorites-first run against real services (not mocks), both roles, full lifecycle + dispute + subscription, sandbox money only. 1–3 runs per environment
    - _Requirements: 3.2, 4.1, 4.4_
  - [ ]* 11.4 Write integration tests for VPS specifics and DevOps/security/monitoring on the live target
    - Real domains resolve, Traefik terminates valid Let's Encrypt SSL, the api/ws/rtc/storage/auth subdomains route, production-appropriate config in effect; monitoring receiving data; a recent successful backup artifact exists + readable; CI green on HEAD running the intended suites; TLS in transit; no secret in the client bundle; carried-forward `SECRET_EXPOSURE` surfaced. Run on VPS (with local `N/A` where env-only)
    - _Requirements: 5.2, 5.4, 7.1, 7.2, 7.3, 7.5_
  - [ ]* 11.5 Add store artifact build/readiness checks
    - The single Expo codebase builds Android AAB (Play + Galaxy) + iOS build meeting current store technical requirements; icon, screenshots (incl. unfolded), listing metadata, content rating, privacy link, and a reviewer test path present + valid — reviewer credentials supplied to the store WITHOUT committing them to the repo
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 12. Documentation deliverables
  - [ ] 12.1 Write `tools/full-audit/README.md`
    - The audit's purpose; the registry + checklist model; the seven probe types (and why health ≠ integration); the two-environment discipline; the three payment modes; the readiness gate ordering; the clean boundaries with `quality-assurance-pbt` (referenced, not re-run) and `secrets-inventory` (config + secret handling; `SECRET_EXPOSURE` carried forward as blocking)
    - _Requirements: 8.5_
  - [ ] 12.2 Create `docs/deployment/READINESS-CHECKLIST.md` and `docs/deployment/READINESS-RUNBOOK.md`
    - CHECKLIST: the single maintained auditable artifact — every component, edge, integration, live journey, store artifact, and DevOps item with its invariant, per-environment probe, and tri-state status (a re-audit artifact, not a one-off)
    - RUNBOOK: reconcile the registry against owning specs / `ARCHITECTURE.md` first (any `REGISTRY_STALE` divergence blocks + is resolved first) → run local audit → all green → deploy to VPS → run VPS audit → all green → package mobile → submit; how to run per environment; how findings are routed + re-audited; how the operator-gated live-money validation is performed OUTSIDE the automatic audit
    - _Requirements: 8.4, 8.5_
  - [ ] 12.3 Update `docs/ARCHITECTURE.md`, ADR, CHANGELOG, and ROADMAP
    - ARCHITECTURE: add a "Deployment-Readiness Audit (full-audit)" section with the audited-topology Mermaid diagram and the two-environment parity flow; clarify this is a verification/operational module (no new product services, tables, or endpoints)
    - Create `docs/ADR/011-full-audit-live-readiness.md` recording: audit the live assembled system (health ≠ integration); registry-defined "every component" with event-driven `consumes`/`produces`; registry reconciliation before each audit (manual review day-one) with blocking `REGISTRY_STALE`; two-environment parity (same invariant, env-appropriate probe, tri-state justified `N/A`, local-PASS/VPS-FAIL blocking); three separated payment modes; report-and-gate never patch; observability modeled as telemetry/export edges; clean boundaries with Spec 25 and `secrets-inventory`
    - Add a `docs/CHANGELOG.md` entry under `## [Unreleased]` (component registry, readiness checklist + probe library, evaluator + findings reporter, two-environment parity, three payment modes, readiness runbook)
    - Mark the `full-audit` spec status in `.kiro/specs/ROADMAP.md`
    - _Requirements: 8.5_

- [ ] 13. Final checkpoint — audit runs end-to-end and all tests pass
  - Ensure the CLI runs a full audit per environment, emits the reports, and all property/unit tests pass (integration/build checks run per environment by the operator). Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster core; core (non-`*`) tasks build the registry → checklist → probes → evaluator → CLI + docs.
- Each task references specific requirements (Req 1–8) for traceability; property test sub-tasks reference the exact correctness property (Property 1–11) they validate.
- full-audit is a tooling + documentation artifact under `tools/full-audit/` — NOT a NestJS module or mobile screen; it introduces no database entities and no runtime product behavior.
- The authority chain is one-directional: `COMPONENT REGISTRY → PROBES (running system) → READINESS CHECKLIST → READINESS VERDICT`. A `GET /health` 200 is a liveness signal only, never integration proof; the audit never reduces to it.
- Property-based tests use fast-check (the repo's established choice) at min 100 iterations each and are tagged `// Feature: full-audit, Property {n}: {text}` — do NOT implement PBT from scratch.
- The pure core (reconciliation, builder, evaluator, reporter, payment-mode policy) is unit + property tested; the seven probes' running-system behavior is covered by integration tests (1–3 runs per environment, local then VPS), which do not vary meaningfully with generated input.
- Registry reconciliation runs FIRST (day-one a documented manual review), so the checklist is always built over a verified-complete registry (guards Property 1).
- The automatic audit is structurally confined to `sandbox`/`live-readiness`; `operator-live-money` (a real transaction) is a manual, operator-gated action NEVER part of the automatic audit; no secret is ever printed, rotated, or emitted in evidence/findings.
- full-audit reports and gates; it never patches behavior/config, never invents config (`secrets-inventory`'s job), never rotates secrets, and never re-runs Spec 25's suites (references their green result). Findings are routed to owners; the operator executes the irreversible deploy/submit/live-money actions in order local-GREEN → VPS-GREEN → package → submit.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "7.1"] },
    { "id": 1, "tasks": ["2.2", "7.2", "8.1"] },
    { "id": 2, "tasks": ["2.3", "4.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7"] },
    { "id": 3, "tasks": ["4.2", "5.1", "8.8"] },
    { "id": 4, "tasks": ["5.2", "9.1", "9.2"] },
    { "id": 5, "tasks": ["9.3", "11.1"] },
    { "id": 6, "tasks": ["11.2", "11.3", "11.4", "11.5", "12.1", "12.2"] },
    { "id": 7, "tasks": ["12.3"] }
  ]
}
```

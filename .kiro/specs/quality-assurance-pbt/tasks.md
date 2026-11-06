# Implementation Plan: Quality Assurance & Property-Based Testing (PBT)

## Overview

`quality-assurance-pbt` (Spec 25, Sprint 7 — QA & Formal Testing) is the platform's system-wide quality gate. It depends on all specs (1–24) and is **not a product feature**: it adds test suites, harnesses, fixtures, a properties catalog, a cross-module contract matrix, conflict/gap reporting, governance-exception handling, and CI wiring. **It changes no product behavior** — a defect it finds is fixed in the owning feature (and its spec); this module owns the *verification*, the feature specs own the *behavior*.

Its guarantee is bounded and defensible, not "the whole system is proven correct": (a) every *declared* correctness property maps to ≥1 executable test and those pass to the coverage this spec defines; (b) the defined E2E journeys pass; (c) the configured tiers (PBT / integration / load) meet their thresholds; and (d) uncovered behavior, cross-spec contradictions, and verification limits are *reported* — never silently patched by inventing behavior.

This plan is bottom-up and builds incrementally, mirroring the sibling specs (dispute-system, stripe-escrow): QA config + constants + fail-fast `validateQaConfig()` + the `.env.example` keys → typed models/enums (`catalog.types.ts`, `matrix.types.ts`, `findings.types.ts`) → the versioned source artifacts (`properties-catalog.yaml`, `governance-exceptions.yaml`, `cross-module-contract-matrix.yaml`) + their loaders/schema validators → the pure/seam-isolated analyzer logic layer (`CatalogBuilder`, `CatalogReconciler`, `CoverageReporter` + `CoverageGate`, `StalenessDetector`, governance-exception handling, `ConflictDetector`, `DeletionCoherenceChecker`, `FindingsReporter`) → the shared typed fast-check arbitraries + injectable clock/RNG/provider seams → the contract-tested external-service mocks (Stripe, RevenueCat, OneSignal, LiveKit, Bedrock) → the real-infra Docker harness (`docker-compose.qa.yml`) + integration tests → the E2E journeys (A–E + favorites-first) → the k6 load scenarios + governed thresholds → the PBT for the QA logic itself (PQA1..PQA15) + the per-analyzer unit tests → CI wiring (formal-core `qa-analysis` gate + scheduled heavy-tier workflows + AI Hypothesis PBT under `ai-tests`) → docs.

The QA logic layer is pure/seam-isolated, so it is unit- and property-tested in CI; the heavy tiers (full E2E, k6, full real-infra matrix incl. Keycloak + MinIO) run as scheduled nightly/pre-release workflows, documented, never silently skipped. Real infra (Postgres+PostGIS, Redis, Keycloak, MinIO) runs via Docker; external/paid services (Stripe, RevenueCat, OneSignal, LiveKit, Bedrock) are exercised only via sandbox or contract-tested mocks — never real credentials, never a live endpoint, never real money. QA adds **no product database tables and no runtime schema**; its "data models" are versioned repo artifacts + generated report artifacts.

Scope: consolidate every spec's declared properties into one drift-checked catalog (a projection of the specs, reconciled every run); enforce two distinct coverage kinds (property vs code) where a known gap never silently passes CI; detect cross-module conflicts over a structured contract matrix for a closed set of conflict classes; verify deletion/lifecycle coherence; route defects vs gaps distinctly; prove the QA logic's own meta-properties PQA1..PQA15. See `requirements.md` (Req 1–8 incl. 1.1a/1.2a/1.2b/1.2c/1.6 and 2.1–2.8 + REQ-QA1…REQ-QA12) and `design.md` (Properties PQA1–PQA15).

## Tasks

- [ ] 1. QA config, constants & `.env.example`
  - [ ] 1.1 Add quality-assurance-pbt env keys to `.env.example`
    - Add `PBT_MIN_ITERATIONS_FLOOR`, `PBT_HIGH_RISK_ITERATIONS`, `PBT_SHRINKING_ENABLED`, `K6_MIN_VUS`, `COVERAGE_FLOOR_BUSINESS`, `COVERAGE_FLOOR_API`, `COVERAGE_FLOOR_CRITICAL_UI`, `E2E_MIN_FLOWS`, `CADENCE_HEAVY_TIERS`, `DOCKER_POSTGRES_VERSION`, `DOCKER_REDIS_VERSION`, `DOCKER_KEYCLOAK_VERSION`, `DOCKER_MINIO_VERSION`, `PROVIDER_SANDBOX_MODE`, `QA_CATALOG_PATH`, `QA_GOVERNANCE_EXCEPTIONS_PATH`, `QA_CONTRACT_MATRIX_PATH`, and `QA_REPORTS_DIR`; document that all external-provider credentials used by contract tests / E2E / load resolve to **sandbox/test values only** (never real production secrets, never real money), that `PROVIDER_SANDBOX_MODE` forces sandbox/mock for all providers, and that the `secrets-inventory`/`full-audit` specs own production secrets, not QA
    - _Requirements: 8.1, 8.2 · PQA13_
  - [ ] 1.2 Create QA config + constants with fail-fast `validateQaConfig()`
    - Create `packages/qa/src/qa.config.ts` (all tunables sourced from env/constants — no magic numbers) and `packages/qa/src/config/validate-qa-config.ts`: parse every `PBT_*`/`K6_*`/`COVERAGE_*`/`E2E_MIN_FLOWS`/`CADENCE_HEAVY_TIERS`/`DOCKER_*`/`PROVIDER_SANDBOX_MODE`/`QA_*` value; `validateQaConfig()` fails fast at startup (skipped under `NODE_ENV=test` for unit runs): all iteration/VU/floor/flow values `> 0`; **`PBT_MIN_ITERATIONS_FLOOR >= 100`**; **`K6_MIN_VUS >= 100`**; `PBT_HIGH_RISK_ITERATIONS >= PBT_MIN_ITERATIONS_FLOOR`; coverage floors within `0–100` and matching the plan's minimums (business 90 / API 80 / critical-UI 70); `E2E_MIN_FLOWS >= 5`; `PBT_SHRINKING_ENABLED` true; all four `DOCKER_*` versions present; `PROVIDER_SANDBOX_MODE` on (no prod-key pattern present); catalog + governance-exceptions + contract-matrix paths resolvable; `QA_REPORTS_DIR` present; no hardcoded values in logic
    - _Requirements: 8.1, 8.2, 8.3 · PQA13_

- [ ] 2. Typed models & enums
  - [ ] 2.1 Create catalog types & enums
    - Create `packages/qa/src/catalog/catalog.types.ts`: `PropertyEntry` (`{ propertyId, owningSpec, statement, statementVersion, verificationType, tests[] (stable ids), tags? }`), `PropertyDeclaration`, `SpecDeclaration` (`{ propertyId, owningSpec, statement, statementVersion }`), `StableTestId`, `Catalog`, `CatalogError`, `DriftFinding`, `TestReview` (`{ testId, reviewedStatementVersion, testContentHash, approvalRef }`), `StaleMapping`, `GovernanceException` (`{ propertyId, status, owner, expiresAt, approvalRef }`); enums `VerificationType` (`PBT`/`unit`/`integration`/`E2E`) and `ExceptionStatus` (`OPEN`/`ACCEPTED`); typed, no `any`
    - _Requirements: 1.1, 1.1a, 2.8 · PQA1, PQA4_
  - [ ] 2.2 Create contract-matrix types & enums
    - Create `packages/qa/src/contract-matrix/matrix.types.ts`: `Predicate` (`{ subject, op: 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'|'in'|'not_in'|'exists'|'not_exists', value? }`), `Contract` (structured `{ producer, consumer, stateTransition?, event, preconditions[], postconditions[], resource, owner, deleteRule, effect?, note?, version }`), `Contradiction`, `OutOfScopeNote`, `FkMetadata`, `CoherenceViolation`; enums `DeleteRule` (`CASCADE`/`SET_NULL`/`RESTRICT`/`NONE`), `ConflictClass` (`PRODUCER_POST_VS_CONSUMER_PRE`/`INCOMPATIBLE_DELETE_RULE`/`UNSATISFIABLE_SHARED_INVARIANT`), `RelationClass` (`user-owned`/`shared-history`); the `note` field is documented as human-readable only, never used by detection
    - _Requirements: 6.1, 6.4 · PQA8, PQA9_
  - [ ] 2.3 Create findings types & enums
    - Create `packages/qa/src/findings/findings.types.ts`: the `Finding` union — `{ kind: 'defect', owningFeature, propertyId, reproducer }`, `{ kind: 'gap', subKind: 'unspecified', owningSpec, propertyId?, reproducer }`, `{ kind: 'conflict', specs[], contractIds[], conflictClass, reproducer? }`, `{ kind: 'coherence', owningSpec, relation, expected, actual }` — plus `Reproducer` (`{ seed, minimalCase }`), `FindingReport`; enums `FindingKind` (`defect`/`gap`/`conflict`/`coherence`), `ResponseClass` (`success`/`retry`/`duplicate`/`timeout`/`failure`), `ExternalProvider` (`stripe`/`revenuecat`/`onesignal`/`livekit`/`bedrock`); no prescribed-behavior/resolution field exists on any finding type
    - _Requirements: 2.6, 3.4, 6.2, 6.3 · PQA7, PQA11_

- [ ] 3. Versioned source artifacts + loaders/validators
  - [ ] 3.1 Author the properties catalog + its loader/schema validator
    - Create `packages/qa/src/catalog/properties-catalog.yaml` consolidating every declared property across specs 1–24 (`P*`/`REQ-VP*`/`REQ-NP*`/`REQ-ST*`/`REQ-VV*`/`REQ-CP*`/`REQ-SC*`/`REQ-DS*`/`REQ-FV*`/`REQ-TH*`/`REQ-SM*` + Sprint 1–3), one entry per `propertyId` with `{ propertyId, owningSpec, statement, statementVersion, verificationType, tests[] (stable ids), tags? }` (high-risk + module tags), and `packages/qa/src/catalog/catalog-loader.ts` that parses the YAML and schema-validates every entry (enum-valid `verificationType`; required fields non-empty; non-empty `tests` unless explicitly gap-tagged); a malformed entry surfaces a `CatalogError` and is not admitted
    - _Requirements: 1.1, 1.1a, 2.1, 2.8 · PQA1, PQA4_
  - [ ] 3.2 Author the governance-exceptions artifact + loader
    - Create `packages/qa/src/catalog/governance-exceptions.yaml` (`{ propertyId, status: OPEN|ACCEPTED, owner, expiresAt (ISO-8601 UTC), approvalRef }`) and its loader (parse + schema-validate: `status` in enum; on `ACCEPTED` all four fields non-empty and `expiresAt` parseable) so an accepted, time-boxed unmapped-property exception is a diff-reviewable versioned record
    - _Requirements: 1.2b, 1.2c · PQA10_
  - [ ] 3.3 Author the cross-module contract matrix + loader/schema validator
    - Create `packages/qa/src/contract-matrix/cross-module-contract-matrix.yaml` with one structured row per inter-module contract covering at least offer↔negotiation↔escrow, service-tracking↔completion↔dispute, subscription↔commission↔favorites↔ads, notifications↔lifecycle/delete, chat↔calls↔account-deletion (structured `preconditions[]`/`postconditions[]` predicates, `resource`, `owner`, `deleteRule`, `effect?`, `version`; `note` human-readable only), and a loader that schema-validates each row (predicates well-formed, `deleteRule` enum-valid, `version` present)
    - _Requirements: 6.1, 6.4 · PQA8, PQA9_

- [ ] 4. Catalog analyzers — builder, reconciler, staleness
  - [ ] 4.1 Implement CatalogBuilder (pure, lossless bijection)
    - Create `packages/qa/src/catalog/catalog-builder.ts`: `build(declarations)` → `{ catalog, errors }` — consolidate per-spec declarations into a catalog keyed by `propertyId` (bijection: no loss, no dup, `owningSpec`/`statement`/`statementVersion`/`verificationType` preserved); a **duplicate `propertyId`** yields a `CatalogError` listing the id + its conflicting `owningSpec` values (never a silent merge/overwrite); a **malformed entry** (missing/invalid required field or out-of-enum `verificationType`) yields a `CatalogError` and is **not admitted** to the catalog; pure, no I/O
    - _Requirements: 1.1, 1.1a, 1.6 · PQA1_
  - [ ] 4.2 Implement CatalogReconciler (catalog↔spec drift → fail CI)
    - Create `packages/qa/src/catalog/catalog-reconciler.ts`: `reconcile(catalog, declarations)` → `DriftFinding[]` — report drift iff the catalog diverges from the authoritative per-spec declarations (a declared property **missing** from the catalog, or a catalog `statement`/`owningSpec`/`statementVersion` that **differs** from the spec's), identifying the offending `propertyId` + divergent field; a faithful projection yields `[]`; pure
    - _Requirements: 1.1 · PQA15_
  - [ ] 4.3 Implement StalenessDetector (statementVersion + content-hash-backed review)
    - Create `packages/qa/src/catalog/staleness-detector.ts`: `detect(catalog, reviews, currentHashes)` → `StaleMapping[]` — flag a mapping **stale iff** the property's current `statementVersion` is greater than the `reviewedStatementVersion` of any mapped test **or** a review's recorded `testContentHash` disagrees with the test's current source (an invalid review); a bare `reviewedStatementVersion` bump with no test change (hash mismatch) stays stale; an all-current-and-hash-valid mapping is never falsely flagged; pure
    - _Requirements: 1.3 · PQA3_

- [ ] 5. Coverage analyzers — reporter + gate
  - [ ] 5.1 Implement CoverageReporter (two metrics + accepted-exception breakout)
    - Create `packages/qa/src/coverage/coverage-reporter.ts`: build `CoverageReport` — `property` computed **only** from mapping/pass state (`declared`, `mappedPassing`, `coveragePct = mappedPassing/declared`, `exceptions[]` broken out separately, `unmapped[]` broken out separately, `fullyMappedOrAccepted`), and `code` computed **only** from the runner (`businessLogicPct`, `apiPct`, `criticalUiPct`, `e2eFlowCount`); an `ACCEPTED`, unexpired governance exception is surfaced as an EXCEPTION line item and is **never** folded into `mappedPassing`/`coveragePct` and never reported as full/complete coverage; discovered gaps live in the findings report, not here; pure
    - _Requirements: 1.2, 1.2c, 1.4, 7.3 · PQA10_
  - [ ] 5.2 Implement CoverageGate (mapped-or-accepted-exception, pure predicate)
    - Create `packages/qa/src/coverage/coverage-gate.ts`: `evaluate(report, floors, now)` → `GateResult` — passes **iff** every declared property is either mapped-to-a-passing-test **or** covered by an `ACCEPTED` exception whose fields are complete and whose `expiresAt` is strictly after `now`, **and** every code-coverage bucket meets its floor, **and** the E2E flow count meets its floor; an **unmapped property with no accepted exception fails** (merely reporting it does not pass the gate); an expired/malformed exception fails; a sub-floor bucket fails; code coverage never substitutes for property coverage; pure
    - _Requirements: 1.2, 1.2a, 1.2b, 1.2c, 7.3 · PQA10_

- [ ] 6. Conflict & coherence analyzers + findings reporter
  - [ ] 6.1 Implement ConflictDetector (sound+complete over the declared conflict classes)
    - Create `packages/qa/src/contract-matrix/conflict-detector.ts`: `detect(matrix, catalog)` → `{ contradictions, needsNewConflictClass }` — over the **structured** fields, flag a pair as conflicting **iff** it falls in one of the three declared classes (`PRODUCER_POST_VS_CONSUMER_PRE` — a producer postcondition predicate contradicting a consumer precondition predicate on the same resource/state; `INCOMPATIBLE_DELETE_RULE` — incompatible `deleteRule` on the same relation; `UNSATISFIABLE_SHARED_INVARIANT` — two catalog invariants mutually unsatisfiable on a shared entity/state under the declared predicate vocabulary), identifying the exact pair + `conflictClass`; a consistent matrix yields no contradictions (no false positives); a structurally-suspicious pair outside the declared classes is reported as `needsNewConflictClass`, never silently missed nor falsely claimed as decided; pure
    - _Requirements: 6.1 · PQA8_
  - [ ] 6.2 Implement DeletionCoherenceChecker (CASCADE user-owned vs SET NULL shared-history)
    - Create `packages/qa/src/contract-matrix/deletion-coherence-checker.ts`: `check(matrix, fkMetadata)` → `CoherenceViolation[]` — classify each relation `user-owned`|`shared-history` and flag **exactly** those whose rule violates policy (user-owned favorites/notifications must be `CASCADE` from `users`; shared-history chat/calls/completions/disputes/tracking must be `SET NULL`); a policy-consistent set yields `[]`; reads the matrix `deleteRule` field and (in the real-infra tier) the actual FK metadata; pure
    - _Requirements: 6.4 · PQA9_
  - [ ] 6.3 Implement FindingsReporter (routed by cause, no invented behavior, no drop)
    - Create `packages/qa/src/findings/findings-reporter.ts`: `report(findings)` → `{ reports }` with `reports.length === findings.length` (no silent drop) — route by cause: a `defect` (PBT failure against a declared invariant) → the owning **feature** (fix the code); a `gap`/`unspecified` (behavior no requirement covers) → the owning **spec** (define the behavior); a `conflict`/`coherence` → the owning spec(s) (and `full-audit` where relevant); each report carries the involved feature/specs + property/contract ids + the minimal reproducer + seed, and **never** includes a prescribed-behavior/resolution field; pure
    - _Requirements: 2.6, 6.2, 6.3, 6.5 · PQA7_

- [ ] 7. Shared arbitraries & determinism seams
  - [ ] 7.1 Implement shared typed fast-check arbitraries
    - Create `packages/qa/src/generators/money.arbitraries.ts` (integer minor units + currencies), `geo.arbitraries.ts` (lat/lng, radius, PostGIS points), `identity.arbitraries.ts` (users, roles, participant pairs), and `offer.arbitraries.ts` (offers, negotiation states, phases): each produces only valid-by-construction, typed values (no `any`) with edge coverage (empty, boundary, non-ASCII), reusable across all TS PBT suites
    - _Requirements: 8.3 · PQA1, PQA2_
  - [ ] 7.2 Implement injectable clock / RNG / provider seams + seed helpers
    - Create `packages/qa/src/harness/seam/clock.ts`, `packages/qa/src/harness/seam/rng.ts`, and `packages/qa/src/generators/time-seed.ts`: an injected clock, an injected RNG, and seed record/replay helpers so time, randomness, and external calls are taken from seams — never direct `Date.now()`/`Math.random()`/live network inside test logic — making harnesses deterministic-by-seed and order-independent
    - _Requirements: 2.3, 7.5 · PQA6_

- [ ] 8. Contract-tested external-service mocks
  - [ ] 8.1 Implement Stripe & RevenueCat contract-tested mocks
    - Create `packages/qa/src/mocks/stripe/` (recorded fixtures for PaymentIntent/Transfer/Refund/Reversal + `charge.dispute.*`/`payment_intent.*`/`transfer.*`/`account.updated` webhooks, a mock, and a contract test) and `packages/qa/src/mocks/revenuecat/` (entitlement-state + subscription-lifecycle event fixtures + mock + contract test): each contract test runs the mock across `{ success, retry, duplicate, timeout, failure }`, validates the emitted response/event against the recorded fixture schema, and drives the app consumer to the expected state (e.g. Stripe `duplicate` webhook → idempotent no-op; RevenueCat `retry` → eventual entitlement); no real credential, live endpoint, or real money
    - _Requirements: 3.4 · PQA11_
  - [ ] 8.2 Implement OneSignal, LiveKit & Bedrock contract-tested mocks
    - Create `packages/qa/src/mocks/onesignal/` (send + delivery-callback fixtures + mock + contract test), `packages/qa/src/mocks/livekit/` (room/token + call-lifecycle webhook fixtures + mock + contract test), and `packages/qa/src/mocks/bedrock/` (AI request/response fixtures + mock + contract test): each contract test covers `{ success, retry, duplicate, timeout, failure }`, validates emitted shape against the fixture schema, and drives the consumer to the expected state (e.g. LiveKit `timeout` → call-lifecycle recovery; Bedrock `failure` → graceful degradation); no real credential, live endpoint, or real money
    - _Requirements: 3.4 · PQA11_

- [ ] 9. Real-infra Docker harness & integration tests
  - [ ] 9.1 Implement the real-infra Docker harness (compose + idempotent bootstrap)
    - Create `packages/qa/src/harness/docker-compose.qa.yml` (Postgres+PostGIS, Redis, Keycloak, MinIO — image versions sourced from `DOCKER_*` config, never inline literals) and `packages/qa/src/harness/infra-bootstrap.ts` (bring up / tear down real infra idempotently; connectivity probe for each service); the harness stands up infra only for testing (no product schema of its own — DB uses the owning specs' migrations)
    - _Requirements: 3.1, 8.1 · PQA6_
  - [ ] 9.2 Implement DB-guarantee integration tests (real Postgres)
    - Under the real-infra harness, exercise the owning specs' migrations up **and** down (reversible), transactions, single-winner conditional writes, unique/partial-unique constraints, `ON DELETE` cascade/SET-NULL policies, and the outbox/tombstone drains declared across specs — against real Dockerized Postgres+PostGIS, not mocks
    - _Requirements: 3.1, 3.2 · PQA6, PQA9_
  - [ ] 9.3 Implement cross-module durable-chain integration tests
    - Under the real-infra harness, drive the durable event chains end-to-end and assert the terminal durable state: `offer.matched`→escrow charge; `service_arrived`→video-verification; `checklist_completed`→completion; dispute routing→escrow action — against real infra
    - _Requirements: 3.3 · PQA6_
  - [ ] 9.4 Implement deletion-coherence-vs-real-FK & isolation integration tests
    - Under the real-infra harness, read the live schema's FK metadata and confirm user-owned `CASCADE` vs shared-history `SET NULL` matches the contract matrix (feed `DeletionCoherenceChecker` with real `fkMetadata`); and run a representative slice in random order/subset asserting idempotent teardown resets to baseline (order-independent, no residual state)
    - _Requirements: 3.5, 6.4 · PQA6, PQA9_

- [ ] 10. E2E journeys (Detox/Maestro)
  - [ ] 10.1 Implement E2E journeys A–C + shared support/fixtures
    - Create `packages/qa/e2e/journey-a.registration-kyc-offer.e2e.ts` (Host publishes; Cleaner exercises the register→KYC arm), `journey-b.offer-negotiation-escrow.e2e.ts` (Host + Cleaner both, escrow via Stripe sandbox/mock), `journey-c.escrow-service-completion-release.e2e.ts` (Cleaner performs service tracking→arrival verification→checklist; Host confirms/releases), and `packages/qa/e2e/support/` (per-journey independent fixtures, setup, i18n `en`/`es` parity helpers); each journey is independently runnable with its own fixtures and documents the flow + actor(s) it verifies
    - _Requirements: 4.1, 4.4, 4.5, 8.4 · PQA7, PQA14_
  - [ ] 10.2 Implement E2E journeys D, E + favorites-first
    - Create `packages/qa/e2e/journey-d.dispute-resolution-escrow.e2e.ts` (Host raises; includes the **auto-release path** — no confirmation → auto-release), `journey-e.subscription-pro.e2e.ts` (Cleaner PRO primary + Host PRO variant; verify **subscription→PRO** effects: PRO commission / favorites-unlimited / ad-free via RevenueCat sandbox), and `journey-favorites-first.e2e.ts` (Host favorites a Cleaner + Cleaner receives priority); each independently runnable with its own fixtures; collectively the six journeys cover **both Host and Cleaner** (Req 4.4) and the registry size meets or exceeds `E2E_MIN_FLOWS`; assert `en`/`es` parity on parity-required screens
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.4 · PQA7, PQA14_

- [ ] 11. k6 load scenarios + governed thresholds
  - [ ] 11.1 Author governed thresholds.yaml (distinct SLO vs regression per scenario)
    - Create `packages/qa/load/thresholds.yaml` with, per scenario, `{ owner, rationale, version, slo, regression }` where `slo` is ≥1 **absolute** pass/fail condition (e.g. `p(95) < 500`, `error_rate < 0.01`) and `regression` is ≥0 **relative** checks against the stored prior baseline (e.g. `maxWorseThanBaselinePct`), keeping the two concepts distinct; every hot-path scenario carries a non-empty owner + rationale + version; this spec does not fix the numbers, it requires they be governed and versioned
    - _Requirements: 5.2, 5.5 · PQA12_
  - [ ] 11.2 Implement hot-path k6 scenarios (≥100 VUs)
    - Create `packages/qa/load/radar-delivery.k6.js`, `escrow-charge.k6.js`, `chat-throughput.k6.js`, and `tracking-ingest.k6.js`: each runs at ≥ `K6_MIN_VUS` (100) VUs (from config, not inline) against the Dockerized non-prod env, applies its `slo` (absolute) and `regression` (vs-baseline) blocks from `thresholds.yaml` as pass/fail gates, and emits results to `reports/load-baselines/{scenario}@{version}.json` for the regression comparator; sandbox payments, never real money
    - _Requirements: 5.1, 5.2, 5.4, 5.5 · PQA12_
  - [ ] 11.3 Implement contention k6 scenarios (single-winner / idempotency)
    - Create `packages/qa/load/contention/` scenarios stressing concurrency-sensitive logic (concurrent offer accepts → single-winner escrow charge; concurrent escrow release triggers → single release per payment; concurrent favorite adds → idempotent) at ≥ `K6_MIN_VUS`, each with a post-run assertion that exactly one winner / one effect occurred under real contention; against the Dockerized non-prod env, no real money
    - _Requirements: 5.1, 5.3, 5.4 · PQA12_

- [ ] 12. Property-Based Tests for the QA logic (fast-check, min 100 iterations, seeded, shrinking, tagged `// Feature: quality-assurance-pbt, Property N`)
  - [ ]* 12.1 PQA1 — Catalog is a lossless bijection over propertyId
    - **Property 1: [PQA1] Catalog is a lossless bijection over propertyId**
    - **Validates: Requirements 1.1 · REQ-QA1**
    - Random declaration sets (dup ids, missing fields, varied specs/versions/types): exactly one entry per `propertyId`, no loss/dup, fields preserved; a duplicate `propertyId` or missing required field surfaces a `CatalogError`, never a silent merge/overwrite/omission
  - [ ]* 12.2 PQA2 — Complete coverage partition + required subsets by the right method
    - **Property 2: [PQA2] Complete coverage partition (mapped ∪ unmapped = declared, disjoint), including required subsets by the right method**
    - **Validates: Requirements 1.2, 2.4, 2.5, 2.6 · REQ-QA1, REQ-QA6**
    - Random catalogs × random test-id registries × required-subset configs: `mapped ∪ unmapped == declared`, disjoint; every per-module member (all 22 modules) has executable coverage of the appropriate `verification_type` (not forced to PBT); every high-risk member is PBT-mapped; an unmapped subset member is reported (and fails the gate absent an accepted exception)
  - [ ]* 12.3 PQA3 — Staleness detection on statementVersion (content-hash-backed)
    - **Property 3: [PQA3] Staleness detection on statementVersion**
    - **Validates: Requirements 1.3 · REQ-QA1**
    - Random `(statementVersion, per-test reviewedVersion, testContentHash)` tuples (some bare-bump, some hash-mismatch): stale iff current version > any mapped test's reviewed version OR a review's content hash mismatches; a bare version bump with no test change stays stale; all-current-and-hash-valid never flagged
  - [ ]* 12.4 PQA4 — verification_type integrity and correct runner language
    - **Property 4: [PQA4] verification_type integrity and correct runner language**
    - **Validates: Requirements 2.1, 2.7 · REQ-QA3**
    - Random catalogs × runner/language pairings: `verificationType` in `{ PBT, unit, integration, E2E }`; each mapped test of that kind; PBT ⇒ language-correct library (TypeScript→fast-check, Python→hypothesis); never out-of-enum, wrong-kind, or wrong-library
  - [ ]* 12.5 PQA5 — Iteration floor honored, configurable upward, shrinking always on
    - **Property 5: [PQA5] Iteration floor honored, configurable upward, shrinking always on**
    - **Validates: Requirements 2.2, 2.7 · REQ-QA3**
    - Random per-property iteration configs (below/at/above floor): resolved count ≥ `PBT_MIN_ITERATIONS_FLOOR` (100); overrides raise but never lower; shrinking never disabled; a below-floor value is rejected or clamped up, never run below the floor
  - [ ]* 12.6 PQA6 — Deterministic by seed, isolated, order-independent
    - **Property 6: [PQA6] Deterministic by seed, isolated, order-independent**
    - **Validates: Requirements 2.3, 3.5, 7.5 · REQ-QA4**
    - Random seeds × random orderings/subsets of a representative slice: same seed ⇒ identical outcome + identical shrunk counterexample; a recorded failing seed re-fails; final state reset to baseline by idempotent teardown (order-independent); time/randomness/external calls from injected seams only
  - [ ]* 12.7 PQA7 — Findings actionable, routed by cause, never invent behavior, never dropped
    - **Property 7: [PQA7] Findings are actionable, correctly routed by cause, never invent behavior, never dropped**
    - **Validates: Requirements 2.6, 6.2, 6.3, 6.5 · REQ-QA2, REQ-QA9**
    - Random findings (defect/gap/conflict/coherence): exactly one report per finding (no drop); `defect`→owning feature (fix code), `gap`/unspecified→owning spec (define behavior), conflict/coherence→owning spec(s) (+ full-audit); each report carries feature/specs + property/contract ids + minimal reproducer + seed and **no** prescribed-behavior field
  - [ ]* 12.8 PQA8 — Conflict detection sound+complete for the declared conflict classes
    - **Property 8: [PQA8] Conflict detection is sound and complete for the declared conflict classes over structured fields**
    - **Validates: Requirements 6.1 · REQ-QA9**
    - Random structured contract matrices, some seeded with an in-class contradiction (post⊥pre, delete-rule clash, unsatisfiable shared invariant), some with an out-of-class oddity: flagged iff an in-class contradiction was injected, exact pair + `conflictClass` identified; a consistent matrix ⇒ no flags (no false positives); out-of-class ⇒ reported as needs-new-conflict-class, never silently missed nor over-claimed
  - [ ]* 12.9 PQA9 — Deletion/lifecycle coherence across specs
    - **Property 9: [PQA9] Deletion/lifecycle coherence across specs**
    - **Validates: Requirements 6.4 · REQ-QA9**
    - Random relation sets tagged user-owned/shared-history with declared rules (some wrong): flags exactly the mismatches (user-owned≠CASCADE, shared-history≠SET NULL); a policy-consistent set ⇒ none
  - [ ]* 12.10 PQA10 — Two independent coverage metrics + mapped-or-accepted-exception gate
    - **Property 10: [PQA10] Two independent coverage metrics + a mapped-or-accepted-exception gate; a known gap never passes; code never substitutes property**
    - **Validates: Requirements 1.2, 1.2a, 1.2b, 1.2c, 1.4, 7.3 · REQ-QA1b, REQ-QA10**
    - Random (declared/mapped/passing) × governance-exception sets (accepted/expired/malformed) × per-bucket code coverage × E2E count × eval timestamp: property metric from mapping-only, code from runner-only (independent); property/exception/unmapped/code all distinct line items; exceptions never counted as covered; gate passes iff every property mapped-or-ACCEPTED-unexpired-exception ∧ all floors ∧ E2E count; unmapped-without-exception / expired-exception / sub-floor fails; code never substitutes property
  - [ ]* 12.11 PQA11 — External-service mocks conform to the recorded provider contract
    - **Property 11: [PQA11] External-service mocks conform to the recorded provider contract**
    - **Validates: Requirements 3.4 · REQ-QA5**
    - Per provider (Stripe/RevenueCat/OneSignal/LiveKit/Bedrock) × response class `{ success, retry, duplicate, timeout, failure }`, generated within-class payloads: the mock's emitted response/event validates the recorded contract fixture schema, the consumer reaches the correct state; no real credential, live endpoint, or real money
  - [ ]* 12.12 PQA12 — k6 thresholds governed, SLO (absolute) distinct from regression (vs baseline)
    - **Property 12: [PQA12] k6 thresholds are governed, and SLO (absolute) is distinct from regression (vs baseline)**
    - **Validates: Requirements 5.2, 5.5 · REQ-QA12**
    - Random k6 scenario config maps (missing owner/rationale/version, below-floor VUs, conflated/absent slo/regression blocks): accepted iff every hot-path scenario ≥ `K6_MIN_VUS`, carries owner+rationale+version, and declares distinct `slo` (≥1 absolute) + `regression` (relative-to-baseline) blocks; conflated/ad-hoc/below-floor rejected; at run time an `slo` breach fails regardless of history, a `regression` breach flags even when the `slo` still passes
  - [ ]* 12.13 PQA13 — Config safety — all tunables validated, no magic numbers
    - **Property 13: [PQA13] Config safety — all tunables validated, no magic numbers**
    - **Validates: Requirements 8.1 · REQ-QA11**
    - Random config maps (valid/missing/invalid/out-of-range): `validateQaConfig()` accepts iff every required tunable is present and in range, else fails fast; complement with a lint/static check that iteration/VU/floor/cadence/Docker-version literals never appear inline in test logic
  - [ ]* 12.14 PQA14 — i18n en/es parity in E2E where a spec requires it
    - **Property 14: [PQA14] i18n en/es parity in E2E where a spec requires it**
    - **Validates: Requirements 8.4 · REQ-QA11**
    - Random subsets of parity-required `(screen, key)` pairs: both `en` and `es` resolve every required key (no missing key, no placeholder); a missing/untranslated key fails the parity check
  - [ ]* 12.15 PQA15 — Catalog is a drift-checked projection of the specs
    - **Property 15: [PQA15] Catalog is a drift-checked projection of the specs**
    - **Validates: Requirements 1.1 · REQ-QA1**
    - Random catalogs × authoritative spec-declaration sets (some with missing/differing statement/owningSpec/statementVersion): drift flagged iff a declared property is missing or a statement/owningSpec/statementVersion differs, offending `propertyId` + field identified; a faithful projection ⇒ no drift

- [ ] 13. Unit tests for the QA analyzers
  - [ ]* 13.1 Unit tests — CatalogBuilder / catalog-loader / CatalogReconciler / StalenessDetector
    - `CatalogBuilder`/`catalog-loader`: single-entry-per-id; `CatalogError` on duplicate id (lists conflicting `owningSpec`s) and on missing/invalid field (not admitted); YAML schema validation (enum `verificationType`, non-empty `tests` unless gap-tagged). `CatalogReconciler`: drift on a missing declared property and on each differing field (`statement`/`owningSpec`/`statementVersion`); a faithful projection is clean. `StalenessDetector`: version-comparison edges (equal, newer, older, multiple mapped tests) + review validity (content-hash match vs bare version bump)
    - _Requirements: 1.1, 1.1a, 1.3, 1.6 · PQA1, PQA3, PQA15_
  - [ ]* 13.2 Unit tests — CoverageReporter / CoverageGate / governance exceptions
    - Property / exception / unmapped / code line items from disjoint inputs; gate pass/fail across floor edges; unmapped-without-accepted-exception, expired/malformed exception, and sub-floor all fail; an `ACCEPTED` unexpired exception permits its property but is never counted as covered or reported as full coverage
    - _Requirements: 1.2, 1.2a, 1.2b, 1.2c, 1.4, 7.3 · PQA10_
  - [ ]* 13.3 Unit tests — ConflictDetector / DeletionCoherenceChecker / FindingsReporter
    - `ConflictDetector`: each declared conflict class detected + localized over structured fields; a consistent matrix clean; an out-of-class oddity → needs-new-conflict-class. `DeletionCoherenceChecker`: each policy class + each violation direction. `FindingsReporter`: report shape (feature/specs + ids + reproducer, no behavior field); one-per-finding; routing by cause (`defect`→feature, `gap`/unspecified→spec, conflict/coherence→spec(s)/full-audit)
    - _Requirements: 2.6, 6.1, 6.2, 6.3, 6.4, 6.5 · PQA7, PQA8, PQA9_
  - [ ]* 13.4 Unit tests — iteration resolver, validateQaConfig, threshold validator & shared arbitraries
    - Iteration resolver: floor + per-property override + shrinking flag. `validateQaConfig`: fail-fast on each missing/invalid tunable. Threshold validator: governance edges incl. distinct `slo` (absolute) vs `regression` (vs-baseline) blocks and rejection when conflated / ad-hoc / below-floor. Shared arbitraries (`generators/`): each produces only valid-by-construction typed values with edge coverage (empty, boundary, non-ASCII)
    - _Requirements: 2.2, 5.2, 8.1 · PQA5, PQA12, PQA13_

- [ ] 14. AI-service Hypothesis PBT (Python, under the existing ai-tests job)
  - [ ] 14.1 Implement the AI-service Hypothesis PBT suite
    - Create `services/ai/tests/pbt/` using `hypothesis` with **typed strategies**, a configured `@settings(max_examples=…)` at the ≥100 floor (sourced from config, not inline), shrinking, and explicit/derandomized seeds for reproducibility; implement the PBT for each catalog property whose owning spec is the Python AI/FastAPI service; the catalog references these tests by stable id; runs under the existing Poetry/pytest `ai-tests` job
    - _Requirements: 2.1, 2.2, 2.3, 8.3 · PQA4, PQA5, PQA6_

- [ ] 15. CI wiring — formal-core gate + scheduled heavy tiers
  - [ ] 15.1 Extend ci.yml with the qa-analysis formal-core job
    - Extend `.github/workflows/ci.yml` with a `qa-analysis` job (depends on `api-quality`) that runs catalog build, **catalog↔spec reconciliation**, the coverage gate + governance-exception evaluation, staleness detection, conflict detection, and deletion-coherence over the versioned artifacts; a drift / unmapped-without-accepted-exception / expired-exception / sub-floor / stale result **fails the build (red = no merge)**; add the fast-check QA PBT + unit tests to the API test run and the AI Hypothesis PBT to the existing `ai-tests` job; keep the existing `api-quality`/`api-tests`/`ai-tests` jobs green (green-HEAD preserved); all QA code passes `tsc --noEmit` and `eslint --max-warnings 0` (no `any`)
    - _Requirements: 7.1, 7.3, 7.4, 8.3 · PQA10, PQA15_
  - [ ] 15.2 Add the scheduled heavy-tier workflow(s)
    - Create a scheduled (nightly + pre-release trigger) GitHub Actions workflow under `.github/workflows/` that runs the full real-infra matrix (Postgres+PostGIS, Redis, Keycloak, MinIO integration), the E2E journeys A–E + favorites-first, the k6 load scenarios (hot-path + contention) with governed thresholds, and the external-service contract tests; the cadence is sourced from `CADENCE_HEAVY_TIERS` and documented in the workflow file + QA README; a real-infra container unavailability fails the tier loudly (never silently skipped) and is isolated from the PR formal core
    - _Requirements: 7.2, 7.4 · PQA11, PQA12_

- [ ] 16. Documentation & ROADMAP
  - [ ] 16.1 Write packages/qa/README.md
    - Create `packages/qa/README.md`: QA purpose (verification-only, bounded claim), the six tiers, the formal-core-vs-cadence split, the catalog + governance-exceptions + contract-matrix locations, the catalog↔spec reconciliation step, the governance-exception mechanism (how a known gap is accepted, time-boxed, surfaced as an EXCEPTION — never silently green), how to add a property mapping, how to run each tier locally, the mock contract-testing approach, the k6 SLO-vs-regression split, and all `QA_*`/`PBT_*`/`K6_*`/`COVERAGE_*`/`DOCKER_*`/`PROVIDER_SANDBOX_MODE`/`E2E_MIN_FLOWS`/`CADENCE_HEAVY_TIERS` env vars; note in each owning feature's README that its declared properties are consolidated + verified by `quality-assurance-pbt` (the property stays owned by the feature spec; the catalog is a drift-checked projection)
    - _Requirements: 8.5_
  - [ ] 16.2 Update ARCHITECTURE.md (QA & test-tier topology + Mermaid) and CHANGELOG.md
    - Add to `docs/ARCHITECTURE.md` a QA & test-tier topology note + Mermaid diagram (the six tiers, the analyzers over the catalog + contract matrix, the CI formal-core-vs-cadence topology, the findings feedback loop to owning specs / full-audit, and the QA Docker harness node Postgres+PostGIS · Redis · Keycloak · MinIO used only for testing), clarifying this is a verification module with no new product services/tables/endpoints; add `[Unreleased]` entries to `docs/CHANGELOG.md` per task group (feature `quality-assurance-pbt`): properties catalog + traceability, fast-check + Hypothesis PBT tiers, real-infra integration harness, contract-tested external mocks, E2E journeys, k6 load + governed thresholds, cross-module conflict/ambiguity analysis, CI formal-core gate + cadence tiers
    - _Requirements: 8.5_
  - [ ] 16.3 Write the QA-strategy ADR and mark Spec 25 in ROADMAP
    - Create a new ADR (next free number at merge time) in `docs/ADR/` recording: the PBT properties-catalog with full traceability + staleness detection (content-hash-backed review so a bare version bump can't clear staleness; two coverage kinds never conflated); the governance-exception mechanism (unmapped fails CI unless an `ACCEPTED`, time-boxed exception exists, surfaced as an EXCEPTION, never counted as covered); the catalog↔spec reconciliation step (catalog is a faithful projection, not a hand-maintained copy); real-infra integration via Docker + contract-tested external mocks (across success/retry/duplicate/timeout/failure, never real money/prod secrets); the structured cross-module contract model + closed set of conflict classes (`PRODUCER_POST_VS_CONSUMER_PRE`/`INCOMPATIBLE_DELETE_RULE`/`UNSATISFIABLE_SHARED_INVARIANT`, anything else → needs a new class); the CI cadence-tier split; the k6 SLO-vs-regression split; and the authority decisions (feature spec authoritative; defect-vs-gap routing; bounded claim; conflicts/gaps reported not patched; verification-only); then mark Spec 25 status in `.kiro/specs/ROADMAP.md`
    - _Requirements: 8.5_

- [ ] 17. Final Checkpoint — QA logic tests green, CI formal core green, heavy tiers documented, docs updated
  - Ensure the QA logic unit + property tests (PQA1–PQA15) pass, `tsc --noEmit` + `eslint --max-warnings 0` are clean on `packages/qa`, the `qa-analysis` formal-core job and the existing `api-quality`/`api-tests`/`ai-tests` jobs are green, the scheduled heavy-tier workflow(s) are wired and documented (never silently skipped), and all docs (`packages/qa/README.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, the ADR, `.env.example`, `.kiro/specs/ROADMAP.md`) are updated; confirm no product-behavior-changing task exists (verification-only); ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (property-based, unit, contract, integration, E2E, load).
- Each task references specific requirements; property/unit/contract/integration tests cite the design's PQA1–PQA15 and the requirements' Req 1–8 + REQ-QA1…REQ-QA12.
- **Verification-only (strict).** QA changes no product behavior and holds no business logic. A defect it surfaces is fixed in the owning feature; an unspecified-behavior gap is defined in the owning spec. QA imports product code read-only and never imports a product write-path into its own logic.
- **The catalog is a drift-checked projection of the specs.** The feature specs own behavior + properties; `CatalogBuilder` consolidates them and `CatalogReconciler` fails CI on any drift (missing property, or differing `statement`/`owningSpec`/`statementVersion`) so the catalog can never silently disagree with a spec.
- **Two coverage kinds, never conflated.** Property coverage (mapped-or-explicitly-accepted-exception, a floor of 100%) and code coverage (business 90 / API 80 / critical-UI 70 + 5 E2E) are separate metrics. An unmapped property fails CI unless it carries an `ACCEPTED`, unexpired governance exception, which is surfaced as an EXCEPTION and never counted as covered. Code-coverage floors never substitute for property coverage. A discovered gap is a separate reported finding against the owning spec, distinct from an unmapped property.
- **Real infra where it matters; contract-tested mocks where it must.** Postgres+PostGIS/Redis/Keycloak/MinIO run real (Docker); Stripe/RevenueCat/OneSignal/LiveKit/Bedrock use sandbox or contract-tested mocks across success/retry/duplicate/timeout/failure — never real credentials, never a live endpoint, never real money.
- **CI is the enforcement surface; heavy tiers on a documented cadence.** The formal core (`api-tests` incl. fast-check, `ai-tests` incl. Hypothesis, the new `qa-analysis` job) gates PRs (red = no merge); full E2E, k6, and the full real-infra matrix run nightly/pre-release, documented, never silently skipped; green-HEAD preserved.
- **Conflicts + gaps reported via a defined artifact, never patched.** Conflict detection runs over the structured contract matrix + catalog and is sound + complete only for the three declared conflict classes; anything outside is reported as needing a new class. Findings are routed by cause (defect→feature, gap→spec, conflict/coherence→spec(s)/full-audit) with a minimal reproducer + seed and no prescribed behavior — QA never invents behavior and never drops a finding.
- **Determinism + no magic numbers.** Time/randomness/external calls come from injected seams (clock/RNG/provider); every PBT is seeded, shrinking-on, and runs ≥ `PBT_MIN_ITERATIONS_FLOOR` (100); every tunable (iterations, VUs, floors, cadence, Docker versions) comes from config validated fail-fast by `validateQaConfig()`.
- **Out of scope:** adding/changing/"fixing" product behavior; inventing behavior for uncovered cases; verifying the deployed/live system is wired and running (`full-audit`/deployment-readiness); provisioning production secrets (`secrets-inventory`); real external calls with production credentials or real money; replacing the per-spec tests already written inside each feature's `tasks.md`; being a one-off snapshot (the catalog + suite are maintained as specs evolve).
- CI: the formal-core jobs must stay green on every PR; the heavy tiers run on the documented cadence and fail loudly rather than skip.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "7.1", "7.2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1", "6.2", "6.3"] },
    { "id": 5, "tasks": ["8.1", "8.2", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 7, "tasks": ["10.1", "10.2", "11.1"] },
    { "id": 8, "tasks": ["11.2", "11.3", "14.1"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8"] },
    { "id": 10, "tasks": ["12.9", "12.10", "12.11", "12.12", "12.13", "12.14", "12.15"] },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3", "13.4"] },
    { "id": 12, "tasks": ["15.1", "15.2"] },
    { "id": 13, "tasks": ["16.1", "16.2", "16.3"] }
  ]
}
```

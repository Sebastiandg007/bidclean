# Requirements Document

## Introduction

The `quality-assurance-pbt` module is the system-wide **quality gate**: after every feature is implemented, it **verifies all declared correctness properties to the coverage defined by this spec, exercises the critical end-to-end flows against real infrastructure, checks the hot paths under load, and reports uncovered behavior, cross-spec contradictions, and known verification limits**. It is Spec 25 (Sprint 7 — QA & Formal Testing) and depends on **all specs (1–24)**: it is not a feature, it is the formal verification pass over everything that was built.

**Honest scope of the claim (not "prove the whole system correct").** No test suite can prove the entire system correct. What this spec guarantees is bounded and defensible: (a) every *declared* correctness property maps to executable tests and those pass; (b) the defined E2E journeys pass; (c) the configured tiers (PBT / integration / load) pass their thresholds; and (d) uncovered behavior, contradictions, and verification limits are *reported*. It does not claim exhaustiveness beyond that coverage.

**It verifies existing invariants; it does not invent new behavior.** Every feature spec we wrote declared testable **correctness properties** — `P1…` (chat), `REQ-VP*` (voice/voip), `REQ-NP*` (push), `REQ-ST*` (service-tracking), `REQ-VV*` (video-verification), `REQ-CP*` (checklist), `REQ-SC*` (service-completion), `REQ-DS*` (disputes), `REQ-FV*` (favorites), `REQ-TH*` (theme), `REQ-SM*` (samsung), plus the earlier Sprint 1–3 properties (auth, roles, KYC, profile, offers, escrow, commission, subscriptions, ads). This spec's job is to make those properties **executable and continuously green** at scale — with property-based testing (many generated cases + shrinking), cross-module conflict detection, real-infra integration, and load testing — not to add or change any business rule. If PBT surfaces a case no requirement covers, that is reported as a **gap**, not silently "fixed" by inventing behavior.

**It is additive and non-destructive to the product.** QA adds test suites, harnesses, fixtures, and CI wiring; it does not modify feature behavior. Where a property test reveals a real defect, the fix belongs to the owning feature (and its spec), not to this module. This module owns the *verification*, the owning specs own the *behavior*.

**Authority split (kept clear):**
- **Each feature spec remains the source of truth for its behavior + properties.** QA references and executes them; it never redefines an invariant. A discrepancy between a property test and a spec is resolved by the spec (or flagged as a spec gap), never by weakening the test to pass.
- **The correctness-properties catalog is the single index QA verifies against.** QA consolidates every spec's declared properties into one traceable catalog so coverage is auditable (every declared property maps to at least one executable test).
- **CI is the enforcement surface.** The formal suite runs in CI; a broken invariant fails the build. Load/E2E tiers that are too heavy for every-commit CI run on a defined cadence (nightly/pre-release), documented, not silently skipped.

**Testing stack (from the plan, reused — not re-chosen here):**
- **Property-based:** `fast-check` (TypeScript — API + mobile) and **`hypothesis`** (Python — the AI/FastAPI service), each with a configured **minimum iteration count (100+) and shrinking** so a failing case is minimized to its simplest reproducer.
- **Unit/integration:** Jest + Supertest (API), Jest + RNTL (mobile), pytest (AI).
- **E2E:** Detox or Maestro (mobile critical flows in a simulator).
- **Integration with real infra:** Docker-composed PostgreSQL, Redis, Keycloak, MinIO (and mocked/self-hosted equivalents for Centrifugo/LiveKit/AI where a live external isn't feasible in CI).
- **Load:** k6 (100+ concurrent users on the hottest paths).
- **Contracts:** shared Zod schemas / type checks to keep frontend↔backend in sync.

**Deliberate scope boundaries (to keep it a verification pass, not a second implementation):**
- **Verification only — no behavior changes.** QA writes tests and harnesses; any defect it finds is fixed in the owning feature, not here. This module never contains business logic.
- **Executable properties, not prose.** Every correctness property in the catalog must map to at least one automated test (PBT/integration/E2E); a property with no executable test is itself a reported coverage gap.
- **Real-infra where it matters, mocked where it must.** DB/Redis/Keycloak/MinIO run real (Docker) in the integration tier; genuinely external or heavy services (Stripe, RevenueCat, OneSignal, LiveKit, AWS Bedrock) are exercised via their sandbox or a faithful mock/self-hosted instance — never with real production credentials or real money.
- **Gaps are reported, not patched by inventing rules.** When PBT finds a case no requirement covers, QA files it as an ambiguity/gap against the owning spec; it does not choose a behavior.
- **No flaky-by-design tests.** Property/integration tests must be deterministic given a seed; a failing PBT case must reproduce from its recorded seed/shrink. Time, randomness, and external calls are controlled.
- **Coverage targets are floors, not vanity metrics.** The plan's targets (business logic 90%+, API endpoints 80%+, critical UI 70%+, 5 critical E2E flows) are minimums the suite must meet, measured, not decorative.
- **This is not deployment/audit.** Verifying the *deployed system is wired and live* (integration in the running VPS, secrets present, services connected) is the separate `full-audit`/deployment-readiness concern; QA verifies *code correctness* against infra it stands up for testing.

## Domain Model Overview

```
feature specs (1–24) — each declares testable correctness properties (source of truth for behavior)
        │  consolidated into
        ▼
correctness-properties catalog (the single verification index)
   { propertyId (P#/REQ-VP*/REQ-NP*/REQ-ST*/REQ-VV*/REQ-CP*/REQ-SC*/REQ-DS*/REQ-FV*/REQ-TH*/REQ-SM* + S1–3),
     owningSpec, statement, → mapped to one or more executable tests }
   coverage rule: every declared property maps to ≥1 automated test; unmapped property = reported gap

verification tiers (what runs, where):
  1. Property-based (fast-check TS + hypothesis Py): 100+ cases + shrinking per property; deterministic by seed
       - per-module PBT: auth, roles, KYC, profile, offers, negotiation, escrow, commission, subscriptions,
         ads, chat, voice, voip, push, service-tracking, video-verification, checklist, completion,
         disputes, favorites, theme, samsung
  2. Unit/integration (Jest+Supertest / Jest+RNTL / pytest): module internals + wiring
  3. Integration w/ REAL infra (Docker): PostgreSQL, Redis, Keycloak, MinIO — migrations, transactions,
       single-winner writes, outbox drains, cascades/tombstones, cross-module event flows
  4. E2E (Detox/Maestro): the critical journeys in a simulator
  5. Load (k6): 100+ concurrent users on the hot paths (radar delivery, escrow, chat, tracking)
  6. Cross-module conflict detection: requirements from different specs must not contradict
  7. Ambiguity analysis: PBT-discovered uncovered cases → gap reports against owning specs

critical E2E journeys (the 5+ the plan calls out):
  registration → KYC → publish offer → negotiate → escrow payment → service (track/verify/checklist)
   → completion/release ; plus dispute path ; subscription purchase → PRO commission ; favorites-first
   delivery ; theme + foldable adaptivity smoke

CI enforcement:
  formal suite (PBT + unit + integration) runs in CI → a broken invariant FAILS the build
  heavy tiers (full E2E, k6 load, full real-infra matrix) run on a defined cadence (nightly/pre-release),
  documented, never silently skipped
```

- QA consolidates every spec's declared properties into **one catalog** and guarantees each maps to at least one executable test; an unmapped property is a reported coverage gap.
- It runs a **layered suite** — PBT (fast-check + hypothesis, 100+ cases + shrinking), unit/integration, real-infra integration (Docker), E2E, and k6 load — with the formal core gating CI and heavy tiers on a documented cadence.
- It performs **cross-module conflict detection** and **ambiguity analysis**: contradictions between specs and PBT-discovered uncovered cases are reported as gaps, never silently resolved by inventing behavior.
- It **changes no product behavior**: defects it finds are fixed in the owning feature; QA owns verification, the specs own behavior.

## Glossary

- **Correctness property** — a testable invariant declared by a feature spec (e.g. `REQ-DS6` no-double-refund); QA makes it executable.
- **Properties catalog** — the consolidated, traceable index of every spec's properties, each mapped to ≥1 automated test; the QA verification target.
- **Property-based test (PBT)** — a test that generates many inputs (100+), asserts an invariant holds for all, and **shrinks** a failure to a minimal reproducer; `fast-check` (TS), `hypothesis` (Py).
- **Shrinking** — automatic minimization of a failing generated case to its simplest form for debugging.
- **Real-infra integration** — tests against Dockerized PostgreSQL/Redis/Keycloak/MinIO (not mocks) to catch migration/transaction/cascade/outbox issues.
- **E2E journey** — a full user flow exercised in a simulator (Detox/Maestro).
- **Load test** — k6 scenarios at 100+ concurrent users on hot paths.
- **Cross-module conflict** — two specs' requirements that contradict; detected and reported.
- **Coverage gap** — a declared property with no executable test, or a PBT-found case no requirement covers; reported, not silently patched.
- **Cadence tier** — tests too heavy for every-commit CI (full E2E, k6, full real-infra) run nightly/pre-release, documented.

## Requirements

### Requirement 1 — Consolidated correctness-properties catalog with full traceability

**User Story:** As the platform, I want every declared correctness property tracked and mapped to a test, so that I know the whole system is actually verified, not just claimed.

#### Acceptance Criteria

1. WHEN the QA suite is defined THEN it SHALL consolidate every feature spec's declared correctness properties (Sprint 1–3 properties + `P*`/`REQ-VP*`/`REQ-NP*`/`REQ-ST*`/`REQ-VV*`/`REQ-CP*`/`REQ-SC*`/`REQ-DS*`/`REQ-FV*`/`REQ-TH*`/`REQ-SM*`) into a single traceable catalog `{ propertyId, owningSpec, statement, statementVersion, verification_type, tests[] (stable test ids) }`.
2. WHEN the catalog is built THEN every declared property SHALL map to at least one executable test (PBT, integration, unit, or E2E per its `verification_type`) referenced by a **stable test identifier**; a property with no mapped test SHALL be reported as a coverage gap, not silently omitted.
3. WHEN a property's `statement`/`statementVersion` changes in its owning spec without a corresponding review of its mapped tests THEN CI SHALL fail or report the mapping as **stale** — so a property cannot appear "covered" by a test that no longer verifies its current definition (traceability integrity, not just presence of a link).
4. WHEN QA reports coverage THEN it SHALL report **two distinct metrics**: (a) **property coverage** — declared properties mapped to passing executable tests — and (b) **code coverage** — lines/branches/functions; and it SHALL state explicitly that code-coverage floors do NOT substitute for property coverage (95% lines can still miss a concurrent-release/double-refund invariant).
5. WHEN a property test and its owning spec disagree THEN the spec SHALL be authoritative — the discrepancy is resolved by fixing the code or the spec (or filing a gap), never by weakening the test to pass.

### Requirement 2 — Property-based testing (fast-check + Hypothesis, 100+ iterations, shrinking)

**User Story:** As the platform, I want the tricky invariants generated-and-shrunk, so that edge cases no human enumerated are caught.

#### Acceptance Criteria

1. WHEN a business/correctness invariant is testable by generation THEN it SHALL have a property-based test: `fast-check` for TypeScript (API + mobile) and **`hypothesis` for Python** (the AI/FastAPI service).
2. WHEN a property-based test runs THEN it SHALL execute a configured minimum of iterations (**100+ per property**) and SHALL use shrinking so any failure is minimized to its simplest reproducer.
3. WHEN a property test fails THEN it SHALL be reproducible from a recorded seed (deterministic given the seed) so the failure can be re-run and debugged.
4. WHEN money/state invariants are tested THEN PBT SHALL cover the high-risk ones already declared: single-winner transitions (voip/completion/disputes), no-double-pay / no-double-refund, idempotent intents (outbox, release, dispute financial), server-authoritative validation (geofence, object inspection), stale-safe attempts (transcription, verification), tier/limit enforcement (favorites, commission), and ordering/idempotency (chat/voice sequence, push dedup).
5. WHEN each module is covered THEN there SHALL be per-module PBT for auth, roles, KYC, profile, offers, negotiation, escrow, commission, subscriptions, ads, chat, voice-notes, voip-calls, push, service-tracking, video-verification, checklist, completion, disputes, favorites, theme, and samsung adaptivity.
6. WHEN a PBT surfaces a case no requirement covers THEN QA SHALL file it as an ambiguity/gap against the owning spec and SHALL NOT invent a behavior to make the test pass.
7. WHEN a property's iteration count is set THEN 100+ SHALL be the floor, but the count SHALL be **configurable per property/risk** (complex state machines — escrow, disputes, concurrency, idempotency — MAY require far more), and not every property SHALL be PBT: the catalog SHALL record a `verification_type ∈ { PBT, unit, integration, E2E }` per property so a property is verified by the appropriate method, not forced into generation.

### Requirement 3 — Integration with real infrastructure (Docker)

**User Story:** As the platform, I want the DB/queue/auth/storage-touching code tested against real services, so that migrations, transactions, and cascades are proven, not mocked away.

#### Acceptance Criteria

1. WHEN integration tests run THEN they SHALL execute against Dockerized **PostgreSQL (+PostGIS), Redis, Keycloak, and MinIO** — real instances, not mocks — for the paths that depend on them.
2. WHEN DB-level guarantees are verified THEN integration tests SHALL exercise migrations (up/down), transactions, the single-winner conditional writes, unique/partial-unique constraints, `ON DELETE` cascade/SET-NULL policies, and the outbox/tombstone drains declared across specs.
3. WHEN cross-module event flows are verified THEN integration tests SHALL exercise the durable event chains (e.g. `offer.matched`→escrow, `service_arrived`→video-verification, `checklist_completed`→completion, dispute routing→escrow action) end-to-end against real infra.
4. WHEN genuinely external services are involved (Stripe, RevenueCat, OneSignal, LiveKit, AWS Bedrock) THEN they SHALL be exercised via sandbox or **contract-tested** mocks/self-hosted instances — never real production credentials, never real money. A "faithful mock" is not a mock that merely returns 200: each such mock SHALL be **contract-tested against the documented provider responses/events the application actually consumes**, covering success, retry, **duplicate**, timeout, and failure cases (Stripe webhooks, RevenueCat events, OneSignal delivery callbacks, LiveKit call-lifecycle webhooks, Bedrock AI responses), so a mock cannot pass while the real provider would behave differently.
5. WHEN integration tests complete THEN they SHALL clean up their infra/state so runs are repeatable and isolated.

### Requirement 4 — End-to-end critical journeys

**User Story:** As the platform, I want the core user journeys tested end to end, so that the happy paths (and key failure paths) actually work together.

#### Acceptance Criteria

1. WHEN E2E is defined THEN the critical lifecycle SHALL be split into **discrete, independently-runnable journeys** (not one fragile monolith): Journey A registration → KYC → offer; Journey B offer → negotiation → escrow; Journey C escrow → service (tracking → arrival verification → checklist) → completion → release; Journey D dispute → resolution → escrow effect; Journey E subscription → PRO entitlement; plus a Favorites-first delivery journey. Each is a separate E2E so a failure localizes to a stage.
2. WHEN the failure/edge journeys are covered THEN Journey D (dispute) and the auto-release path (no confirmation → auto-release) SHALL be included as above.
3. WHEN monetization is covered THEN Journey E SHALL verify a subscription purchase → PRO reflected (PRO commission / favorites-unlimited / ad-free).
4. WHEN E2E runs on mobile THEN it SHALL use Detox or Maestro against a simulator, and cover both Host and Cleaner role flows.
5. WHEN at least 5 critical E2E flows are required THEN the split journeys (A–E + favorites-first) SHALL meet or exceed that, and each SHALL be documented as to what journey it verifies; a shared setup/fixtures layer MAY chain them for a full smoke run, but each SHALL also run independently.

### Requirement 5 — Load testing (k6)

**User Story:** As the platform, I want the hot paths tested under concurrency, so that launch traffic doesn't break matching, payments, or realtime.

#### Acceptance Criteria

1. WHEN load tests run THEN they SHALL use k6 with at least 100 concurrent virtual users on the hottest paths (offer radar delivery/expansion, escrow charge, chat throughput, service-tracking position ingest).
2. WHEN a load scenario runs THEN it SHALL assert performance/error thresholds (latency, error rate) as pass/fail criteria, not just produce numbers; and those thresholds SHALL be **defined in versioned k6 configuration per scenario, each with an explicit owner and a documented rationale** — not invented ad-hoc (no "p95 < 10s because something had to be there"). This spec does not fix the numbers; it requires they be governed.
3. WHEN load tests exercise concurrency-sensitive logic THEN they SHALL specifically stress the single-winner/idempotency paths (concurrent offer accepts, concurrent release triggers, concurrent favorite adds) to confirm no double-effects under real contention.
4. WHEN load tests run THEN they SHALL run against a realistic (Dockerized) environment, not production, and never move real money.
5. WHEN load results are produced THEN they SHALL be recorded/comparable across runs so regressions are visible.

### Requirement 6 — Cross-module conflict detection & ambiguity analysis

**User Story:** As the platform, I want contradictions between specs and uncovered cases surfaced, so that the system is coherent and gaps are known.

#### Acceptance Criteria

1. WHEN cross-module contradictions are checked THEN QA SHALL maintain a **cross-module contract matrix** — an explicit, versioned artifact with, per inter-module contract, `{ producer, consumer, event/state, precondition, postcondition, ownership, lifecycle/delete rule }` (covering at least: offer↔negotiation↔escrow, service-tracking↔completion↔dispute, subscription↔commission↔favorites↔ads, notifications↔lifecycle/delete, chat↔calls↔account-deletion) — and SHALL run conflict detection **against that matrix + the property catalog**, reporting any two requirements that cannot both hold. Conflict detection is a verifiable analysis over a defined artifact, not an unspecified "check".
2. WHEN PBT explores input space THEN cases that no requirement covers (ambiguities) SHALL be reported as gaps against the owning spec, with the minimal reproducer.
3. WHEN a conflict or gap is found THEN it SHALL be recorded as an actionable report (which specs, which properties, the reproducer) — QA does not resolve it by inventing behavior.
4. WHEN deletion/lifecycle coherence is checked THEN QA SHALL verify the deliberate cross-spec policy (user-owned data CASCADE from users — favorites/notifications; shared history SET NULL — chat/calls/completions/disputes/tracking) holds consistently, flagging any violation.
5. WHEN the analysis completes THEN its output SHALL feed back to the owning specs (and, where relevant, to the `full-audit` spec) rather than being discarded.

### Requirement 7 — CI enforcement, cadence, and coverage floors

**User Story:** As the platform, I want the verification to actually gate merges and releases, so that quality is enforced, not aspirational.

#### Acceptance Criteria

1. WHEN the formal suite (PBT + unit + integration) runs THEN it SHALL run in CI on the relevant jobs, and a broken invariant/failed property SHALL fail the build (no merge on red).
2. WHEN a test tier is too heavy for every-commit CI (full E2E, k6 load, full real-infra matrix) THEN it SHALL run on a defined, documented cadence (nightly/pre-release), never silently skipped.
3. WHEN coverage is measured THEN **two separate coverage kinds** SHALL be reported: (a) **property coverage** — 100% of declared correctness properties mapped to passing tests (any gap reported) — and (b) **code coverage** — the plan's floors: business logic 90%+, API endpoints 80%+, critical UI 70%+, and the 5+ critical E2E flows. Both are measured minimums; the code-coverage floors SHALL NOT be treated as a substitute for property coverage (the concurrency/money invariants are covered by properties, not by line count).
4. WHEN the CI jobs are extended THEN they SHALL fit the existing pipeline (API lint/typecheck, API tests, AI tests) and add the AI Hypothesis PBT + the heavier cadence tiers without breaking the green-HEAD rule.
5. WHEN tests are added THEN they SHALL be deterministic (seeded), isolated, and not flaky-by-design; time/randomness/external calls SHALL be controlled so CI is trustworthy.

### Requirement 8 — Configuration, standards, and no hardcoded values

**User Story:** As a maintainer, I want the QA layer to follow the project's own standards, so that the tests are themselves maintainable and honest.

#### Acceptance Criteria

1. WHEN QA reads any tunable (PBT iteration counts, k6 VU counts/thresholds, coverage floors, cadence schedules, Docker service versions) THEN it SHALL come from config/constants, not hardcoded magic numbers scattered in tests.
2. WHEN tests use credentials THEN they SHALL use test/sandbox credentials from test config only — never real production secrets, never real money — consistent with the secrets policy.
3. WHEN QA code is written THEN it SHALL follow the project TS/Python standards (typed, no `any`, hypothesis strategies typed) and the clean-code rules, since test code is code.
4. WHEN QA touches i18n-bearing UI in E2E THEN it SHALL verify `en`/`es` parity where a spec requires it.
5. WHEN the QA module is introduced THEN it SHALL be documented (a QA/testing README, the properties-catalog location, ARCHITECTURE note on the test tiers/CI cadence, CHANGELOG, and an ADR for the PBT-catalog + real-infra + cadence-tier strategy) per the project documentation rules.

## Correctness Properties (business invariants)

These are the invariants of the QA system itself (meta-properties); its tests verify the *product's* properties, and these ensure the QA is honest.

- **REQ-QA1 — Full traceability with staleness detection.** Every declared property maps to ≥1 executable test by stable id and carries a `statementVersion` + `verification_type`; a property whose statement changes without test review is flagged **stale** (not silently "covered"); any unmapped property is a reported gap. *(Req 1.1, 1.2, 1.3)*
- **REQ-QA1b — Property coverage ≠ code coverage.** Two distinct metrics are reported; 100% property coverage is required (gaps reported), code-coverage floors (90/80/70) are separate minimums and never a substitute for property coverage. *(Req 1.4, 7.3)*
- **REQ-QA2 — Spec is authoritative; claim is bounded.** A test never overrides a spec (discrepancy → fix code/spec or file a gap, never weaken the test); and QA claims only coverage-bounded verification + reporting of gaps/contradictions/limits, not proof that the whole system is correct. *(Req 1.5, 2.6, Introduction)*
- **REQ-QA3 — Generated + shrunk, risk-configurable, right-method.** PBT runs a 100+ floor with shrinking in fast-check (TS) and hypothesis (Py), configurable higher per property/risk; and each property is verified by its appropriate `verification_type` (PBT/unit/integration/E2E), not everything forced into generation. *(Req 2.1, 2.2, 2.7)*
- **REQ-QA4 — Deterministic + reproducible.** Every PBT/integration failure reproduces from a recorded seed; time/randomness/external calls are controlled; no flaky-by-design tests. *(Req 2.3, 7.5)*
- **REQ-QA5 — Real infra where it matters; mocks are contract-tested.** DB/Redis/Keycloak/MinIO run real (Docker) for the paths that depend on them; external/paid services use sandbox or **contract-tested** mocks (success/retry/duplicate/timeout/failure against documented provider responses/events), never real money or prod secrets — so a mock can't pass while the real provider diverges. *(Req 3.1, 3.4, 8.2)*
- **REQ-QA6 — High-risk invariants covered.** Single-winner, no-double-pay/refund, idempotent intents, server-authoritative validation, stale-safe attempts, tier limits, and ordering/idempotency all have PBT coverage. *(Req 2.4, 5.3)*
- **REQ-QA7 — Critical journeys E2E.** ≥5 critical E2E journeys (incl. the full service lifecycle, dispute, auto-release, subscription→PRO) pass in a simulator for both roles. *(Req 4.1–4.5)*
- **REQ-QA8 — Load-proven hot paths.** k6 ≥100 VUs on hot paths with pass/fail thresholds, stressing concurrency-sensitive single-winner logic, against non-prod infra with no real money. *(Req 5.1–5.4)*
- **REQ-QA9 — Conflicts + gaps reported via a defined artifact, not patched.** Conflict detection runs against a versioned **cross-module contract matrix** (producer/consumer/event/pre/post/ownership/lifecycle) + the property catalog; contradictions and PBT-found uncovered cases are reported with reproducers to owning specs; QA never invents behavior; cross-spec deletion/lifecycle coherence (CASCADE user-owned vs SET NULL shared-history) is verified. *(Req 6.1–6.5)*
- **REQ-QA12 — Load SLOs are governed.** k6 thresholds live in versioned per-scenario config with an explicit owner + rationale, not ad-hoc numbers; E2E is split into independently-runnable journeys (A–E + favorites-first), not a fragile monolith. *(Req 5.2, 4.1, 4.5)*
- **REQ-QA10 — CI-enforced with documented cadence + floors.** The formal core gates CI (red = no merge); heavy tiers run on a documented cadence; coverage floors (90/80/70 + 5 E2E) are measured minimums; green-HEAD preserved. *(Req 7.1–7.4)*
- **REQ-QA11 — Verification-only, standards-compliant.** QA changes no product behavior (defects fixed in owning features), uses test/sandbox credentials only, and follows the project's TS/Python/clean-code standards (test code is code). *(Introduction scope, Req 8.2, 8.3)*

## Non-Goals

- Adding, changing, or "fixing" product behavior — QA verifies; defects are fixed in the owning feature/spec. This module holds no business logic.
- Inventing behavior for uncovered cases — ambiguities are reported as gaps, resolved by the owning spec.
- Verifying the deployed/live system is wired and running — that is `full-audit`/deployment-readiness (the running VPS, secrets present, services connected in production). QA verifies code correctness against infra it stands up for testing.
- Managing or provisioning production secrets/credentials — that is `secrets-inventory`; QA uses only test/sandbox credentials.
- Real external calls with production credentials or real money — external/paid services are sandboxed or mocked.
- Replacing the per-spec tests already written inside each feature's `tasks.md` — QA consolidates, adds the system-wide PBT/E2E/load/conflict tiers, and enforces the catalog; it does not delete a feature's own unit tests.
- Being a one-off snapshot — the properties catalog and suite are maintained as specs evolve.

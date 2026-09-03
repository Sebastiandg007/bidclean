# Implementation Plan: secrets-inventory

## Overview

This plan builds the `secrets-inventory` tooling under `tools/config-inventory/` in TypeScript (the language used throughout the design, matching the repo's existing NestJS/Expo stack and fast-check PBT choice). The work proceeds bottom-up: first the shared inventory model and types, then the `.env.example` parser and the six per-source scanners that emit `DiscoveryProvenance`, then the pure engines (reconcile, classify + boundary check, exposure/hygiene scanner), then the report/CLI that renders the canonical model into `.env.example`, the inventory doc, and findings JSON. Property-based tests (fast-check, 100+ iterations, tagged) sit next to each pure engine, followed by integration tests against the real repo, CI wiring, and documentation deliverables.

Everything derives from the authority chain: config sources → canonical inventory model → `.env.example` (shape only) → runtime env. No credential is ever rotated, moved, or emitted; a discovered exposure is a blocking finding only.

## Tasks

- [ ] 1. Set up tooling structure and the canonical inventory model
  - Create `tools/config-inventory/` directory with a `package.json`/tsconfig wiring (or extend the existing workspace config) and a `sources/` subfolder
  - Create `tools/config-inventory/inventory.model.ts` defining `Surface`, `Kind`, `SourceType` (APPLICATION | BUILD | DEPLOY | INFRA | CI | RUNTIME), `DiscoveryProvenance`, `RequiredScope` (runtime|build|deploy|infra), `EnvApplicability` (local|staging|production), `OrphanJustification`, `ConfigVariable`, `DeclaredVariable`, `FindingCode`, `Finding`, `InventoryReport`
  - Encode the two orthogonal axes as separate types (`requiredScope` vs `envApplicability`) with no shared tokens
  - Add JSDoc on each type explaining the authority chain and the orthogonality rule
  - _Requirements: 1.2, 1.3; Design: inventory.model.ts_

- [ ] 2. Implement the `.env.example` parser
  - [ ] 2.1 Implement `sources/env-example-parser.ts`
    - Parse `.env.example` into `EnvExampleEntry[]` preserving `# --- Section ---` headers as `section`/group and trailing/preceding comments as documented purpose
    - Extract the placeholder value after `=` and any required/optional annotation from the comment
    - Treat parsed entries strictly as presentation input (never authoritative for existence)
    - _Requirements: 2.1, 1.3; Design: env-example-parser.ts_
  - [ ]* 2.2 Write unit tests for the parser
    - Test sectioning and comment extraction on fixtures using the real committed section headers
    - _Requirements: 2.1; Design: Testing Strategy (Example-based)_

- [ ] 3. Implement the six per-source scanners
  - [ ] 3.1 Implement `sources/application-scanner.ts` (APPLICATION)
    - Scan `services/api/src/**/*.constants.ts` for `process.env.NAME` reads and keys each `validateXxxConfig()` asserts as required (push to `errors` → `requiredScope` includes `runtime`)
    - Scan AI pydantic `BaseSettings` subclasses (non-empty default → optional; validated-required → runtime-required) and `apps/mobile/app.config.ts` + `EXPO_PUBLIC_*` usage
    - Emit `DeclaredVariable` with `DiscoveryProvenance{ sourceType: 'APPLICATION', sourceFile, sourceLocation }`
    - _Requirements: 1.1, 1.2, 3.1; Design: application-scanner_
  - [ ] 3.2 Implement `sources/build-scanner.ts` (BUILD)
    - Parse `apps/mobile/eas.json` build profiles and Expo build-time config/tokens → `requiredScope` includes `build`
    - Emit provenance with `sourceType: 'BUILD'`
    - _Requirements: 1.1, 1.2, 4.5; Design: build-scanner_
  - [ ] 3.3 Implement `sources/deploy-scanner.ts` (DEPLOY)
    - Parse deployment scripts, VPS env manifests, and Traefik config → `requiredScope` includes `deploy`
    - Emit provenance with `sourceType: 'DEPLOY'`
    - _Requirements: 1.1, 1.2, 4.1; Design: deploy-scanner_
  - [ ] 3.4 Implement `sources/infra-scanner.ts` (INFRA)
    - Parse `docker-compose*.yml` resolving `${VAR}` shell interpolation, plus infra YAML/JSON → `requiredScope` includes `infra`
    - Emit provenance with `sourceType: 'INFRA'`
    - _Requirements: 1.1, 1.2, 3.4; Design: infra-scanner_
  - [ ] 3.5 Implement `sources/ci-scanner.ts` (CI)
    - Parse `.github/workflows/*.yml` `env:` blocks and `codemagic.yaml` env
    - Emit provenance with `sourceType: 'CI'`
    - _Requirements: 1.1, 1.2; Design: ci-scanner_
  - [ ] 3.6 Implement `sources/runtime-scanner.ts` (RUNTIME)
    - Capture dynamic/indirect `process.env` / `os.environ` reads not covered by APPLICATION and config that propagates indirectly to another module
    - Emit provenance with `sourceType: 'RUNTIME'`
    - _Requirements: 1.1, 1.2; Design: runtime-scanner_
  - [ ] 3.7 Implement the scanner registry and merge
    - Define `scanners: Record<SourceType, SourceScanner>` and a merge step that unions `DeclaredVariable`s by `name`, accumulating the full `DiscoveryProvenance` set (every discovery site kept)
    - _Requirements: 1.1, 1.4; Design: Components §2, data-flow merge_
  - [ ]* 3.8 Write unit tests for scanner provenance and merge
    - Assert each scanner emits its own `sourceType`; assert merge unions provenance for a variable seen by multiple sources
    - _Requirements: 1.1, 1.4; Design: Testing Strategy_

- [ ] 4. Checkpoint - Ensure model + scanners compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement the reconciliation engine
  - [ ] 5.1 Implement `reconcile.ts`
    - Given declared variables and `.env.example` entries, compute `missingInEnvExample`, `orphanedInEnvExample`, and `requiredMismatches`
    - Fix direction by the authority chain: sources win on existence; `.env.example` may not declare an unrecognized variable
    - Treat an orphan as either removed or kept with a structured `OrphanJustification` (`{ type, owner, expiresAt }`), never free text; surface `DEPRECATED` or past-`expiresAt` orphans
    - _Requirements: 1.3, 1.4, 2.1; Design: reconcile.ts_
  - [ ]* 5.2 Write property test for reconciliation completeness across taxonomy
    - **Property 1: Reconciliation completeness across the full source taxonomy**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1**
  - [ ]* 5.3 Write property test for orphan detection
    - **Property 2: Orphan detection is exhaustive**
    - **Validates: Requirements 1.3, 2.1**
  - [ ]* 5.4 Write property test for missing/orphan symmetry
    - **Property 3: Reconciliation missing/orphan symmetry**
    - **Validates: Requirements 1.3, 1.4**
  - [ ]* 5.5 Write property test for authority chain
    - **Property 4: Authority chain forbids unrecognized declarations**
    - **Validates: Requirements 1.3, 2.1**

- [ ] 6. Implement the classifier and public/secret boundary check
  - [ ] 6.1 Implement `classify.ts` classification
    - Assign `kind` (candidate `SECRET` for `*_SECRET`/`*_API_KEY`/`*_PASSWORD`/`*_PRIVATE_KEY`/service-account/signing secrets; `EXPO_PUBLIC_*` candidate `PUBLIC`; else `CONFIG`), `surface`, and `requiredScope`
    - Treat the heuristic as a candidate, carrying an explicit classification per entry (never a verdict from naming alone)
    - Map `requiredScope` from validator-asserted requiredness; keep it disjoint from `envApplicability`
    - _Requirements: 1.2, 2.5, 3.2; Design: classify.ts_
  - [ ] 6.2 Implement the public/secret boundary check + AI-surface assertion
    - Emit blocking `SECRET_ON_CLIENT` when a `SECRET` appears on `MOBILE` or is `EXPO_PUBLIC_`-prefixed yet classified `SECRET`
    - Require any client-bundle value to be explicitly classified `PUBLIC`; assert the `AI` surface holds no object-storage (MinIO/S3) credential
    - _Requirements: 3.2, 3.3, 3.5; Design: Components §6_
  - [ ]* 6.3 Write property test for classifier `requiredScope` vs validator
    - **Property 9: requiredScope matches the validator**
    - **Validates: Requirements 2.5, 5.2**
  - [ ]* 6.4 Write property test for scope/env orthogonality
    - **Property 10: Scope and environment axes are orthogonal**
    - **Validates: Requirements 1.2, 4.1**
  - [ ]* 6.5 Write property test for the boundary by classification
    - **Property 6: Public/secret boundary holds by classification**
    - **Validates: Requirements 3.2, 3.5**
  - [ ]* 6.6 Write property test for mis-prefixed secret detection
    - **Property 7: Mis-prefixed secret is caught by classification not naming**
    - **Validates: Requirements 3.2, 3.5**
  - [ ]* 6.7 Write property test for AI surface storage credentials
    - **Property 8: AI surface holds no storage credentials**
    - **Validates: Requirements 3.3**
  - [ ]* 6.8 Write unit tests for classifier heuristics
    - Concrete cases: `STRIPE_SECRET_KEY` (SECRET), `EXPO_PUBLIC_RC_IOS_KEY` (PUBLIC), `CHAT_MESSAGE_MAX_LENGTH` (CONFIG); `CENTRIFUGO_TOKEN_SECRET` runtime-required vs `CHAT_HISTORY_PAGE_SIZE` default
    - _Requirements: 2.5, 3.2; Design: Testing Strategy (Example-based)_

- [ ] 7. Implement the exposure & hygiene scanner
  - [ ] 7.1 Implement `exposure-scanner.ts`
    - Run `git check-ignore` on runtime env files (`.env`, `.env.local`, `.env.staging`, `.env.production`); run a tracked-file scan via `git ls-files`
    - Run a secret-pattern scan over tracked files, skipping `.env.example` placeholders, combining generic detectors (PEM blocks, high-entropy assignments) with provider-specific detectors (Stripe, AWS, RevenueCat, OneSignal, Keycloak, LiveKit)
    - Emit blocking `SECRET_EXPOSURE` for any tracked env file or matched pattern, naming file/line/provider only (never the captured value); never mutate/move/rotate; set `noKnownExposureDetected` and phrase clean runs as "no known secret-pattern exposure detected"
    - Treat `git` unavailability as an inconclusive/blocking error, not a pass
    - _Requirements: 1.6, 6.3; Design: exposure-scanner.ts, Error Handling_
  - [ ]* 7.2 Write property test for exposure flagging
    - **Property 11: Exposure scan flags any known-pattern secret in a tracked artifact** (temp fixture repo, mocked `git`, assert file bytes unchanged)
    - **Validates: Requirements 1.6, 6.3**

- [ ] 8. Implement report rendering, compliance, and CLI
  - [ ] 8.1 Implement `report.ts`
    - Render the canonical model (one-directional) into: `docs/CONFIGURATION-INVENTORY.md` with per-surface views (API/AI/MOBILE/INFRA) and separate `requiredScope`/`env applicability` columns, the reconciled `.env.example` shape (placeholders only), a machine-readable findings/inventory JSON, and aggregated findings
    - Set `compliant = false` iff any blocking finding exists; emit only safe placeholders for `SECRET`-kind values
    - _Requirements: 1.5, 2.1, 2.2, 3.1, 6.1, 6.2; Design: report.ts, Data Models_
  - [ ] 8.2 Implement `inventory.cli.ts`
    - Wire the CLI to run all six scanners → merge → reconcile → classify + boundary → exposure → report; exit non-zero on any blocking finding or drift
    - _Requirements: 5.2, 6.1; Design: inventory.cli.ts_
  - [ ]* 8.3 Write property test for no known secret pattern in artifacts
    - **Property 5: No known secret pattern in produced artifacts**
    - **Validates: Requirements 1.5, 2.2, 2.4, 6.2**
  - [ ]* 8.4 Write property test for compliance flag
    - **Property 12: Compliance requires zero blocking findings**
    - **Validates: Requirements 1.6, 3.5**

- [ ] 9. Checkpoint - Ensure all engine + report tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Reconcile `.env.example` against the real repo (superset)
  - [ ] 10.1 Run the CLI over the real tree and reconcile `.env.example`
    - Extend the committed `.env.example` (existing sectioned format) so every inventory variable across specs 14–25 + infra families is present: infra (DATABASE/REDIS/MINIO/KEYCLOAK/CENTRIFUGO/LIVEKIT/TRAEFIK/monitoring), payments/monetization/ads, comms (ONESIGNAL/LIBRETRANSLATE/CHAT/VOICE/VOIP/NOTIFICATIONS), service exec (SERVICE/VIDEO_VERIFICATION/CHECKLIST_PHOTO/SERVICE_AUTO_RELEASE), sprint6 (DISPUTE/FAVORITES), ai (AWS Bedrock/KYC), cross-cutting + per-country config
    - Each variable: safe placeholder, one-line purpose comment, required/optional matching its validator, secrets marked server/infra-side (never `EXPO_PUBLIC_*`)
    - Resolve all `MISSING_IN_ENV_EXAMPLE` and either remove or add `OrphanJustification` for `ORPHANED_ENV_EXAMPLE`
    - _Requirements: 2.1, 2.2, 2.5, 4.2, 4.3, 4.4; Design: Variable families table_
  - [ ]* 10.2 Write integration test: reconciliation over the real tree
    - Run all six scanners against real sources and reconcile against committed `.env.example`; assert zero `MISSING_IN_ENV_EXAMPLE`, zero unjustified orphans, and every variable carries provenance
    - _Requirements: 1.1, 1.4, 2.1; Design: Testing Strategy (Integration)_
  - [ ]* 10.3 Write integration test: boundary + exposure over the real repo
    - Assert no `SECRET_ON_CLIENT` and AI surface has no storage credential; `git check-ignore` confirms `.env*` ignored; tracked-file scan confirms no runtime env tracked; secret-pattern scan reports "no known secret-pattern exposure detected" (or fails with `SECRET_EXPOSURE` as designed)
    - _Requirements: 1.6, 3.3, 3.5, 6.3; Design: Testing Strategy (Integration)_

- [ ] 11. Wire the `config-inventory` CI job
  - Add a `config-inventory` job (extending `.github/workflows/ci.yml`) that runs the reconciliation + boundary + exposure checks and fails the build on any blocking finding or drift, keeping the inventory a maintained artifact
  - _Requirements: 5.2, 6.1; Design: CI wiring_

- [ ] 12. Documentation deliverables
  - [ ] 12.1 Create `docs/CONFIGURATION-INVENTORY.md` and the bring-up runbook
    - Maintained human-facing inventory doc (placeholders only) with per-surface views; document the deterministic bring-up runbook (copy `.env.example` → env per surface → fill operator values → `docker compose up` infra → start services so `validateXxxConfig()` runs → adapt variables until validators pass), reproducible for local and VPS, noting operator-supplied vs infra-generated values, and the "configured & startup-valid ≠ healthy" boundary
    - Reference the doc from the deployment docs
    - _Requirements: 4.1, 5.1, 5.3, 5.4, 5.5, 6.1, 6.2; Design: Documentation deliverables_
  - [ ] 12.2 Update `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, and add ADR-010
    - Add a "Configuration Surfaces" note + Mermaid diagram of API/AI/MOBILE/INFRA surfaces and the public/secret boundary
    - Create `docs/ADR/010-configuration-inventory-and-secret-boundary.md` recording the configuration-inventory + source taxonomy + orthogonal `requiredScope`/`envApplicability` axes + public/secret-boundary + no-rotation-this-iteration decisions
    - Add a `## [Unreleased]` CHANGELOG entry
    - _Requirements: 6.5; Design: Documentation deliverables_

- [ ] 13. Final checkpoint - Ensure all tests pass and CI is green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (property, unit, and integration tests) and can be skipped for a faster MVP, but they encode Correctness Properties 1–12 and the acceptance gates.
- Property-based tests use **fast-check** (the repo's existing PBT choice from quality-assurance-pbt), minimum 100 iterations each, tagged `// Feature: secrets-inventory, Property {n}: {property text}`. Do not implement PBT from scratch.
- Each property test maps to exactly one design property; generators produce arbitrary catalogs with varied `sourceType`/provenance, independent `requiredScope`/`envApplicability`, orphans with/without valid justification, mis-prefixed secrets, and synthetic files with/without secret patterns.
- No credential is ever rotated, moved, or emitted; a discovered exposure is a blocking finding only (`compliant = false`).
- This workflow produces planning artifacts only. Begin implementation by opening tasks.md and clicking "Start task" next to a task item.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 2, "tasks": ["2.2", "3.7"] },
    { "id": 3, "tasks": ["3.8", "5.1", "6.1", "7.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "6.2", "6.3", "6.4", "6.8", "7.2"] },
    { "id": 5, "tasks": ["6.5", "6.6", "6.7", "8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "11"] },
    { "id": 9, "tasks": ["12.1", "12.2"] }
  ]
}
```

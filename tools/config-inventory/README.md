# config-inventory

## Purpose

Tooling for the `secrets-inventory` meta-spec. It produces the single, complete, code-derived catalog of every external configuration input BidClean needs across four surfaces (API, AI, MOBILE, INFRA), reconciles the committed `.env.example` against that catalog, enforces the hard public/secret boundary, classifies each variable by `requiredScope`, and reports (never rotates) any `SECRET_EXPOSURE` finding. It is a tooling + documentation artifact — not a NestJS module — and introduces no database entities and no runtime feature behavior.

The **canonical inventory model** (`ConfigVariable[]`) is the single derived source of truth for a variable's existence, classification, and requiredness. `.env.example` is a generated/reconciled PRESENTATION projection of that model — never an authority feeding back into it. Authority chain: `CODE / CONFIG SOURCES → CANONICAL INVENTORY MODEL → .env.example → RUNTIME ENV / Vault`.

## Files

| File | Responsibility |
|------|---------------|
| `inventory.model.ts` | Canonical types: `ConfigVariable`, `Surface`, `Kind`, `SourceType`, `RequiredScope`, `EnvApplicability`, `DiscoveryProvenance`, `OrphanJustification`, `Finding`, `FindingCode`, `InventoryReport`, `DeclaredVariable`, `SourceScanner`. Single derived source of truth for a variable's existence, classification, and requiredness. |
| `orphan-justifications.ts` | Curated registry (`ORPHAN_JUSTIFICATIONS` + `JUSTIFIED_ORPHAN_NAMES`) of structured `OrphanJustification`s for `.env.example` entries deliberately kept with no code reader. Each is accountable (`owner`) and time-bounded (`expiresAt`); only names listed here may remain orphaned without an `ORPHANED_ENV_EXAMPLE` finding. Covers `BUILD_ONLY` / `EXTERNAL_TOOL` orphans (consumed outside scanned app code) and `LEGACY` orphans (documented but currently hardcoded). |
| `sources/scanner-utils.ts` | Shared, dependency-free scanner helpers: safe file reads (`readSource`, failing loudly via `ScannerReadError`), recursive file discovery, repo-relative path + env-name extraction for provenance |
| `sources/application-scanner.ts` | APPLICATION source: `*.constants.ts` + `validateXxxConfig()` keys, pydantic `BaseSettings`, `app.config.ts`, `EXPO_PUBLIC_*` usage |
| `sources/build-scanner.ts` | BUILD source: `eas.json` build profiles, Expo build-time config, build tokens |
| `sources/infra-scanner.ts` | INFRA source: `docker-compose*.yml` under `infra/`, resolving `${VAR}` / `${VAR:-default}` interpolation (literal `environment:` values are container-internal defaults, not emitted) |
| `sources/ci-scanner.ts` | CI source: `.github/workflows/*.yml` `env:` blocks (workflow/job/service/step level) + `codemagic.yaml` when present |
| `sources/env-example-parser.ts` | Parses `.env.example` into shape entries (presentation input only) |
| `classify.ts` | Classifies each merged variable: assigns `kind` (SECRET\|CONFIG\|PUBLIC), `requiredScope`, `envApplicability`, and a safe placeholder, then runs the public/secret boundary check (`checkBoundary`). Classification is by rule + explicit override and is meant to be VERIFIED against where the value flows — the `EXPO_PUBLIC_` prefix alone never proves safety. |
| `merge.ts` | Merges per-source `DeclaredVariable[]` into the canonical model, unioning provenance by variable name. |
| `reconcile.ts` | Diff engine: missing / orphaned / mismatched between declared variables and `.env.example`. |
| `exposure-scanner.ts` | Secret-exposure & hygiene scan: `git check-ignore` on runtime env files + tracked-file scan (`git ls-files`) + secret-pattern scan over tracked files (generic + provider-specific detectors, skipping `.env.example`). Reports blocking `SECRET_EXPOSURE` findings referencing file/line/provider — never the captured value, and never rotates. A clean run means only "no KNOWN pattern matched", never proof of absence; missing `git` is blocking, not a pass. |

### Planned (per `.kiro/specs/secrets-inventory/design.md`)

| File | Responsibility |
|------|---------------|
| `sources/deploy-scanner.ts` | DEPLOY source: deployment scripts, VPS env manifests, Traefik config |
| `sources/runtime-scanner.ts` | RUNTIME source: dynamic/indirect `process.env` / `os.environ` reads |
| `report.ts` | Renders the canonical model → inventory doc + `.env.example` + JSON + findings (one-directional projection) |
| `inventory.cli.ts` | Entry point; also runnable as the `config-inventory` CI job |

### Tests (`__tests__/`)

| File | Responsibility |
|------|---------------|
| `__tests__/arbitraries.ts` | Shared **fast-check** arbitraries for the property-based suites: generates arbitrary `DeclaredVariable`s across the full source taxonomy, `.env.example` entry sets, and `requiredScope` / `envApplicability` tuples, so edge cases come from generation rather than hand-written examples. Not a suite itself — a support module imported by the PBT specs. |

## Dependencies

- Reads (does not modify) configuration sources across the repo: `services/api/src/**/*.constants.ts` + `validateXxxConfig()`, the AI service pydantic settings, `apps/mobile/app.config.ts` / `eas.json`, `docker-compose*.yml`, `.github/workflows/*.yml`, `codemagic.yaml`, and the committed `.env.example`.
- Uses `git` (`git check-ignore`, `git ls-files`) for the exposure/hygiene scan. `git` being unavailable is treated as an inconclusive/blocking result, never a false "clean".
- Testing uses **fast-check** for the property-based suites (the repo's established PBT choice) — do not reimplement PBT from scratch.

## Scope Boundaries

- **No rotation this iteration.** Nothing rotates, revokes, regenerates, moves, or stages any existing credential. A real secret found in a committed/tracked artifact is a blocking `SECRET_EXPOSURE` finding — reported, config marked NOT compliant, secret left untouched. Remediation is deferred to separate secrets-security work.
- **Ends at "configured & startup-valid"**, not "operational/healthy". Verifying the deployed VPS is reachable/healthy is `full-audit`/deployment-readiness, not this tooling.
- **`.env.example` is placeholders only** — never a real secret value.

## How to Run

Planned entry point (not yet implemented): `inventory.cli.ts` runs all six per-source scanners, merges by name (unioning provenance), reconciles against `.env.example`, runs the classifier + boundary check + exposure scan, and emits `docs/CONFIGURATION-INVENTORY.md` + machine JSON + findings. Wired as the `config-inventory` CI job so drift or any blocking finding fails the build.

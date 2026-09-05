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

| `sources/deploy-scanner.ts` | DEPLOY source: deployment scripts, VPS env manifests, Traefik config under `infra/docker` / `infra/traefik`, resolving `${VAR}` interpolation (absent in the current tree → no variables, no failure). |
| `sources/runtime-scanner.ts` | RUNTIME source: dynamic/indirect reads — TS `process.env[...]` bracket access (e.g. the rate-limit guard) and Python `os.environ`/`os.getenv` — harvesting the UPPER_SNAKE string-literal names used in files that perform such reads. |
| `sources/index.ts` | Registry of the six per-source scanners (`scanners: Record<SourceType, SourceScanner>`); the CLI runs all six and the model layer merges by name. |
| `report.ts` | Renders the CANONICAL model → inventory doc + reconciled `.env.example` shape + findings JSON + catalog JSON, plus `buildInventoryReport()` (aggregate report; `compliant` is false iff a blocking finding exists). One-directional projection — never feeds presentation artifacts back into the catalog. |
| `inventory.ts` | Pure orchestration: runs the six scanners, builds the canonical catalog, attaches orphan justifications, reconciles against `.env.example`, runs boundary + exposure checks, and aggregates into a single `InventoryReport`. No process I/O (directly testable). |
| `inventory.cli.ts` | Entry point (also the `config-inventory` CI job). Runs the pipeline, writes the doc + reconciled `.env.example` shape + findings/catalog JSON under `out/`, prints a summary, and exits non-zero on any blocking finding. Supports `--check` (read-only) and `--repo-root=`. |

### Tests (`__tests__/`)

| File | Responsibility |
|------|---------------|
| `__tests__/arbitraries.ts` | Shared **fast-check** arbitraries for the property-based suites: generates arbitrary `DeclaredVariable`s across the full source taxonomy, `.env.example` entry sets, and `requiredScope` / `envApplicability` tuples, so edge cases come from generation rather than hand-written examples. Not a suite itself — a support module imported by the PBT specs. |
| `__tests__/classify.property.spec.ts` | Property-based suite for the classifier + public/secret boundary check (`classify.ts`). |
| `__tests__/reconcile.property.spec.ts` | Property-based suite for the diff engine (`reconcile.ts`): missing / orphaned / mismatched between declared variables and `.env.example`. |
| `__tests__/exposure.property.spec.ts` | Property-based suite for the exposure scanner (`exposure-scanner.ts`, Property 11) + compliance rule in `report.ts` (Property 12). Uses a temp fixture repo with a mocked `GitRunner` (no real credential involved) and asserts the "never mutates" invariant (file bytes unchanged) and that findings never contain the secret value. |
| `__tests__/examples.spec.ts` | Example-based unit tests: `.env.example` parser sectioning/comment extraction, classifier heuristics (`STRIPE_SECRET_KEY`→SECRET, `EXPO_PUBLIC_RC_IOS_KEY`→PUBLIC, `CHAT_MESSAGE_MAX_LENGTH`→CONFIG), `requiredScope` mapping, and validator required-name extraction. |
| `__tests__/integration.spec.ts` | Integration suite against the real repo tree (the deliverable's acceptance gate): zero `MISSING_IN_ENV_EXAMPLE`, zero unjustified `ORPHANED_ENV_EXAMPLE`, every variable carries provenance, no `SECRET_ON_CLIENT`, AI surface holds no storage credential, and the known `mcp.json` key surfaces as a blocking `SECRET_EXPOSURE` (untouched → not compliant). |

The 12 property-based suites map one-to-one to Properties 1–12 in `design.md`, each tagged `// Feature: secrets-inventory, Property {n}: …` and run at ≥100 iterations.

## Dependencies

- Reads (does not modify) configuration sources across the repo: `services/api/src/**/*.constants.ts` + `validateXxxConfig()`, the AI service pydantic settings, `apps/mobile/app.config.ts` / `eas.json`, `docker-compose*.yml`, `.github/workflows/*.yml`, `codemagic.yaml`, and the committed `.env.example`.
- Uses `git` (`git check-ignore`, `git ls-files`) for the exposure/hygiene scan. `git` being unavailable is treated as an inconclusive/blocking result, never a false "clean".
- Testing uses **fast-check** for the property-based suites (the repo's established PBT choice) — do not reimplement PBT from scratch.

## Scope Boundaries

- **No rotation this iteration.** Nothing rotates, revokes, regenerates, moves, or stages any existing credential. A real secret found in a committed/tracked artifact is a blocking `SECRET_EXPOSURE` finding — reported, config marked NOT compliant, secret left untouched. Remediation is deferred to separate secrets-security work.
- **Ends at "configured & startup-valid"**, not "operational/healthy". Verifying the deployed VPS is reachable/healthy is `full-audit`/deployment-readiness, not this tooling.
- **`.env.example` is placeholders only** — never a real secret value.

## How to Run

From the repo root:

```
# Full run: write docs/CONFIGURATION-INVENTORY.md + out/ artifacts, exit non-zero on any blocking finding
npx ts-node --project tools/config-inventory/tsconfig.json tools/config-inventory/inventory.cli.ts

# CI gate (read-only, no writes)
npx ts-node --project tools/config-inventory/tsconfig.json tools/config-inventory/inventory.cli.ts --check
```

Quality gates (run from the repo root):

```
npx tsc --noEmit -p tools/config-inventory/tsconfig.json
npx eslint "tools/config-inventory/**/*.ts" --max-warnings 0
npx jest --config tools/config-inventory/jest.config.js
```

The CLI runs all six per-source scanners, merges by name (unioning provenance), reconciles against
`.env.example`, runs the classifier + boundary check + exposure scan, and emits
`docs/CONFIGURATION-INVENTORY.md` + machine JSON + findings under `out/` (git-ignored). Wire it as the
`config-inventory` CI job so drift or any blocking finding fails the build.

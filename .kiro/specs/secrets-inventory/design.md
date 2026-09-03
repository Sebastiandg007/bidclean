# Design Document

## Overview

The `secrets-inventory` module is a **meta / operational spec**: it produces the single, complete catalog of every external configuration input BidClean needs across four surfaces (API, AI, MOBILE, INFRA), reconciles the committed `.env.example` against that catalog, enforces the hard public/secret boundary, classifies each variable by `requiredScope`, produces a deterministic bring-up runbook, and reports (never rotates) any `SECRET_EXPOSURE` finding.

It is **not** a new product feature. It ships no user-facing runtime behavior and introduces no new database tables. Its deliverables are:

1. A **derived inventory catalog** — a machine-checkable list of every variable `{ name, surface, group, kind, requiredScope, envApplicability, placeholder, consumedBy }`, generated from the code + each spec's `validateXxxConfig()` and reconciled against `.env.example`.
2. A **reconciled `.env.example`** — the source of truth for variable *shape* (names, grouping, placeholders, required/optional), extending the existing sectioned format so nothing is missing and nothing is orphaned.
3. **Reconciliation tooling** — a script/test that parses the validators + `.env.example`, computes the diff (missing / orphaned / mismatched), and fails CI when they drift.
4. A **secret-exposure & hygiene scanner** — runs `git check-ignore`, a tracked-file scan, and a secret-pattern scan; surfaces findings without touching any credential.
5. A **bring-up runbook** + **inventory doc** + **ADR-010** + ARCHITECTURE/CHANGELOG updates.

### Authority chain (the design's spine)

Every decision below flows from this one-directional chain:

```
CODE / VALIDATORS  →  INVENTORY  →  .env.example  →  RUNTIME ENV / Vault
  (existence)         (catalog)      (shape)          (actual values)
```

- **Code/validators are authoritative for existence.** A variable is "real" only because some surface reads it (via a `*.constants.ts` const, a pydantic `BaseSettings` field, `docker-compose`, or CI).
- **The inventory is a derived artifact**, never invented. It is reconciled against the code, not hand-authored.
- **`.env.example` is the shape source of truth** and MAY NOT declare a variable that code/validators do not recognize.
- **Runtime env / Vault holds actual values**, operator-supplied, never committed. The mobile client receives `EXPO_PUBLIC_*` values only.

### Explicit scope boundaries (carried from requirements)

- **No rotation, revocation, regeneration, relocation, or staging** of any credential this iteration. Deferred to separate secrets-security work.
- **A discovered real secret in a committed/tracked artifact is a blocking finding** (`SECRET_EXPOSURE = FOUND`): reported, config NOT marked compliant, secret left untouched.
- **Ends at "configured & startup-valid"** (validators pass), NOT "operational/healthy" (that is `full-audit`/deployment-readiness).

## Architecture

### Where the inventory lives

The inventory is a tooling + documentation artifact, not a NestJS module with controllers. It lives in a dedicated tooling location and produces committed docs:

```
tools/config-inventory/
  inventory.model.ts        # types: ConfigVariable, Surface, Kind, RequiredScope, Finding
  sources/
    validator-scanner.ts    # extracts declared vars from *.constants.ts + pydantic config
    env-example-parser.ts   # parses .env.example into shape entries (name, section, comment)
    compose-scanner.ts      # extracts INFRA vars from docker-compose*.yml
    mobile-scanner.ts        # extracts EXPO_PUBLIC_* usage from the Expo app
  reconcile.ts              # diff engine: missing / orphaned / mismatched
  classify.ts               # kind (SECRET|CONFIG|PUBLIC) + requiredScope + surface
  exposure-scanner.ts       # git check-ignore + tracked-file scan + secret-pattern scan
  report.ts                 # emits the inventory doc + machine JSON + findings
  inventory.cli.ts          # entry point (also runnable in CI)

docs/
  CONFIGURATION-INVENTORY.md  # the maintained, human-facing inventory doc (placeholders only)
  ADR/010-configuration-inventory-and-secret-boundary.md
```

The reconciliation and exposure checks are also wired as a **CI job** and a **test suite**, so drift and exposure fail loudly rather than silently rot.

### Data-flow: how the catalog is derived and checked

```mermaid
flowchart TD
    subgraph SOURCES[Authoritative sources - existence]
        V["*.constants.ts<br/>validateXxxConfig()"]
        P["pydantic BaseSettings<br/>(AI service)"]
        C["docker-compose*.yml"]
        M["EXPO_PUBLIC_* usage<br/>(Expo app + config plugin)"]
    end

    V --> SCAN[validator-scanner]
    P --> SCAN
    C --> COMPOSE[compose-scanner]
    M --> MOB[mobile-scanner]

    SCAN --> INV[Inventory catalog<br/>derived, not invented]
    COMPOSE --> INV
    MOB --> INV

    EX[".env.example<br/>(shape)"] --> PARSE[env-example-parser]

    INV --> RECON[reconcile.ts]
    PARSE --> RECON

    RECON -->|missing var| ADD["Flag: add to .env.example"]
    RECON -->|orphan entry| ORPH["Flag: orphaned - remove/justify"]
    RECON -->|required mismatch| MIS["Flag: required-vs-optional drift"]

    INV --> CLASS[classify.ts<br/>kind + requiredScope + surface]
    CLASS --> BOUND{Public/secret<br/>boundary check}
    BOUND -->|SECRET on MOBILE| LEAK["BLOCKING: secret in client surface"]
    BOUND -->|ok| VIEWS[Per-surface views<br/>API / AI / MOBILE / INFRA]

    GIT[Repo tracked files] --> EXPO[exposure-scanner]
    EXPO -->|match| SE["SECRET_EXPOSURE = FOUND<br/>reported, NOT compliant,<br/>secret untouched"]

    VIEWS --> REPORT[report.ts]
    ADD --> REPORT
    ORPH --> REPORT
    MIS --> REPORT
    SE --> REPORT
    REPORT --> DOC["CONFIGURATION-INVENTORY.md<br/>+ machine JSON + findings"]
```

### Configuration surfaces (grounded in the real codebase)

| Surface | Runtime home | Reads config via | Never holds |
|---------|-------------|------------------|-------------|
| **API** (NestJS) | server `.env` / VPS env / Vault | `*.constants.ts` consts + `validateXxxConfig()` in `onModuleInit` | — |
| **AI** (FastAPI) | its own `.env` | pydantic `BaseSettings` (`KYCSettings`, etc.) | object-storage credentials (Option A) |
| **MOBILE** (Expo) | build-time `EXPO_PUBLIC_*` | `process.env.EXPO_PUBLIC_*` + Expo config plugin | any SECRET |
| **INFRA** (compose) | service env in `docker-compose*.yml` | container env | — |

The validator pattern is already uniform across the API: each module has a `*.constants.ts` that reads `process.env.X ?? default`, and exports a `validateXxxConfig()` invoked from the module's `onModuleInit()`. The scanner keys off exactly this pattern, so the inventory's authoritative source is the code that already exists.

## Components and Interfaces

### 1. Inventory model (`inventory.model.ts`)

The core type. `requiredScope` is a discriminated set, never a bare boolean, so prod-only / build-time / infra-only requirements are represented faithfully.

```typescript
export type Surface = 'API' | 'AI' | 'MOBILE' | 'INFRA';

export type Kind = 'SECRET' | 'CONFIG' | 'PUBLIC';

/** Necessity is a scope, NOT a bare boolean. */
export type RequiredScope =
  | 'runtime'              // a fail-fast validator rejects startup without it
  | 'build'               // needed at build-time (e.g. an EXPO_PUBLIC_* token)
  | 'deploy'              // needed to deploy (VPS/CI) but not local runtime
  | 'infra'               // needed by a docker-compose service bootstrap
  | 'environment-specific'; // required in prod, optional/absent locally

export type EnvApplicability = ReadonlyArray<'local' | 'staging' | 'production'>;

export interface ConfigVariable {
  readonly name: string;                 // e.g. STRIPE_SECRET_KEY
  readonly surface: Surface;
  readonly group: string;                // owning module/section, e.g. "payments"
  readonly kind: Kind;
  readonly requiredScope: readonly RequiredScope[];
  readonly envApplicability: EnvApplicability;
  readonly placeholder: string;          // safe placeholder, NEVER a real value
  readonly consumedBy: readonly string[]; // consts/validators/services that read it
  readonly notes?: string;
}

export type FindingCode =
  | 'MISSING_IN_ENV_EXAMPLE'    // code reads it, .env.example lacks it
  | 'ORPHANED_ENV_EXAMPLE'      // .env.example declares it, no code reads it
  | 'REQUIRED_MISMATCH'         // required-vs-optional drift vs validator
  | 'SECRET_ON_CLIENT'          // a SECRET exposed on the MOBILE surface
  | 'SECRET_EXPOSURE';          // a real secret present in a tracked artifact

export interface Finding {
  readonly code: FindingCode;
  readonly variable?: string;
  readonly detail: string;
  readonly blocking: boolean; // SECRET_EXPOSURE and SECRET_ON_CLIENT are blocking
}

export interface InventoryReport {
  readonly variables: readonly ConfigVariable[];
  readonly findings: readonly Finding[];
  readonly compliant: boolean; // false if any blocking finding exists
}
```

### 2. Validator scanner (`sources/validator-scanner.ts`)

Extracts the authoritative set of variable names each surface reads.

- **API:** scans `services/api/src/**/*.constants.ts` for `process.env.NAME` reads and for the keys each `validateXxxConfig()` asserts as required (the names pushed into the `errors` array on absence). A variable asserted by a validator → `requiredScope` includes `runtime`.
- **AI:** scans pydantic `BaseSettings` subclasses for fields; a field with a non-empty default is optional, a field validated as required is `runtime`-required on the AI surface.
- Returns `{ name, surface, group, consumedBy, requiredByValidator }[]`.

```typescript
export interface DeclaredVariable {
  name: string;
  surface: Surface;
  group: string;
  consumedBy: string[];
  requiredByValidator: boolean;
}

export function scanValidators(repoRoot: string): DeclaredVariable[];
```

### 3. `.env.example` parser (`sources/env-example-parser.ts`)

Parses the committed `.env.example` into shape entries, preserving section headers (`# --- Payments ---`) as the `group` and the trailing comment as the documented purpose/required flag.

```typescript
export interface EnvExampleEntry {
  name: string;
  section: string;      // from the nearest "# --- X ---" header
  placeholder: string;  // the value after '='
  comment?: string;     // inline/preceding comment
}

export function parseEnvExample(path: string): EnvExampleEntry[];
```

### 4. Reconciliation engine (`reconcile.ts`)

The heart of the authority chain. Given declared variables (from code) and `.env.example` entries, computes the diff:

```typescript
export interface ReconcileResult {
  missingInEnvExample: DeclaredVariable[]; // in code, not in .env.example  → add
  orphanedInEnvExample: EnvExampleEntry[];  // in .env.example, no consumer  → flag
  requiredMismatches: Array<{ name: string; declaredRequired: boolean; documentedRequired: boolean }>;
}

export function reconcile(
  declared: DeclaredVariable[],
  envExample: EnvExampleEntry[],
): ReconcileResult;
```

Reconciliation direction is fixed by the authority chain: code wins on existence; `.env.example` must not declare an unrecognized variable (orphan → removed or explicitly justified with a `notes` annotation).

### 5. Classifier (`classify.ts`)

Assigns `kind`, `surface`, and `requiredScope`. **Classification is by rule + explicit override, verified against bundle exposure — never by naming alone.**

- Default heuristics: `*_SECRET`, `*_API_KEY`, `*_PASSWORD`, `*_PRIVATE_KEY`, service-account JSON, shared/signing secrets → candidate `SECRET`; `EXPO_PUBLIC_*` → candidate `PUBLIC`; everything else → `CONFIG`.
- **The heuristic is a candidate, not a verdict.** Each entry carries an explicit classification in the inventory. The boundary check (below) verifies the classification against where the value actually flows (client bundle vs server), so a mis-prefixed secret (`EXPO_PUBLIC_STRIPE_SECRET_KEY`) is caught rather than trusted because of its prefix.

### 6. Public/secret boundary check (in `classify.ts` + `report.ts`)

Auditable invariant:
- Any variable classified `SECRET` appearing on the `MOBILE` surface (or prefixed `EXPO_PUBLIC_` yet classified `SECRET`) → `Finding{ code: 'SECRET_ON_CLIENT', blocking: true }`.
- Any value reaching the client bundle must be explicitly classified `PUBLIC`; the `EXPO_PUBLIC_` prefix alone does not establish safety.
- The AI surface is asserted to hold **no** object-storage credentials (Option A): any MinIO/storage secret classified onto the AI surface is a finding.

### 7. Exposure & hygiene scanner (`exposure-scanner.ts`)

Real verification, not "the `.gitignore` mentions `.env`":

```typescript
export interface ExposureResult {
  checkIgnore: Array<{ file: string; ignored: boolean }>; // git check-ignore
  trackedEnvFiles: string[];   // env files still tracked despite .gitignore
  secretPatternHits: Array<{ file: string; pattern: string; line: number }>;
  findings: Finding[];         // any hit → SECRET_EXPOSURE (blocking), secret untouched
}

export function scanExposure(repoRoot: string): ExposureResult;
```

- Runs `git check-ignore` on the runtime env files (`.env`, `.env.local`, `.env.staging`, `.env.production`).
- Runs a **tracked-file scan** (`git ls-files`) — a file in `.gitignore` can still already be tracked.
- Runs a **secret-pattern scan** (Stripe `sk_live_`/`sk_test_`, RevenueCat `sk_`, PEM blocks, `AKIA` AWS keys, generic high-entropy assignments) across tracked files, **skipping `.env.example` placeholders** by design (placeholders are the expected safe shape).
- Any tracked env file or matched pattern → `SECRET_EXPOSURE = FOUND`, **reported, blocking, secret NOT touched, moved, or rotated**.

### 8. Report & runbook (`report.ts`, `inventory.cli.ts`)

Emits the human doc (`docs/CONFIGURATION-INVENTORY.md`, placeholders only) with per-surface views, a machine-readable JSON for CI assertions, and the aggregated findings. `compliant` is `false` if any blocking finding exists.

## Data Models

This spec introduces **no database entities**. Its "data model" is the in-memory `ConfigVariable` catalog and its serialized forms:

1. **In-memory catalog** — `ConfigVariable[]` (see above).
2. **`.env.example`** — the committed shape artifact, sectioned by module/surface, placeholders only. Existing format is extended, not replaced.
3. **`docs/CONFIGURATION-INVENTORY.md`** — the maintained human doc. Table columns: `name | surface | group | kind | requiredScope | env applicability | placeholder | consumed_by | notes`. No real secret values.
4. **Findings JSON** — the CI-consumable list of `Finding` records.

### Variable families consolidated (superset of current `.env.example` + specs 14–25)

| Group | Surface(s) | Example variables | Kind |
|-------|-----------|-------------------|------|
| infra: database | INFRA/API | `DATABASE_URL`, `POSTGRES_PASSWORD` | SECRET/CONFIG |
| infra: redis | INFRA/API | `REDIS_URL` | CONFIG |
| infra: minio | INFRA/API | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ENDPOINT` | SECRET/CONFIG |
| infra: keycloak | INFRA/API | `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_JWKS_URI` | SECRET/CONFIG |
| infra: centrifugo | INFRA/API | `CENTRIFUGO_API_KEY`, `CENTRIFUGO_TOKEN_SECRET` | SECRET |
| infra: livekit | INFRA/API | LiveKit API key/secret/URL | SECRET/CONFIG |
| payments | API | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENTS_*`, `ESCROW_AUTO_RELEASE_HOURS` | SECRET/CONFIG |
| monetization | API/MOBILE | `REVENUECAT_API_KEY`, `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `EXPO_PUBLIC_RC_IOS_KEY` | SECRET/PUBLIC |
| ads | MOBILE | `EXPO_PUBLIC_ADMOB_*`, `EXPO_PUBLIC_ADS_PROVIDER` | PUBLIC |
| comms | API | `ONESIGNAL_API_KEY`, `LIBRE_TRANSLATE_URL`, `CHAT_*`, `VOICE_*`, `VOIP_*`, `NOTIFICATIONS_*` | SECRET/CONFIG |
| service exec | API | `SERVICE_*`, `VIDEO_VERIFICATION_*`, `CHECKLIST_PHOTO_*`, `SERVICE_AUTO_RELEASE_*` | CONFIG |
| sprint6 | API | `DISPUTE_*`, `FAVORITES_*` | CONFIG |
| ai | AI | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AI_SERVICE_AUTH_TOKEN`, KYC thresholds | SECRET/CONFIG |
| cross-cutting | API/MOBILE | `PORT`, `NODE_ENV`, rate-limit `*`, `DEFAULT_USER_COUNTRY/LANGUAGE`, per-country config | CONFIG |

Per-country config (currencies COP/USD/CAD/EUR/GBP, commission rates, enabled payment methods, compliance toggles) is catalogued as **configuration parameters/flags**, not absorbed business logic — the logic stays in its owning module.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

This spec's core deliverables (the reconciliation engine, the classifier, the boundary check, the exposure scanner) are **pure, deterministic functions over structured inputs** (declared-variable lists, `.env.example` entries, file lists). That makes them genuinely amenable to property-based testing: we can generate arbitrary catalogs and env-example sets and assert universal invariants (the authority chain, the public/secret boundary, orphan/missing symmetry). The documentation, ADR, and runbook deliverables are not property-testable and are covered by the Testing Strategy instead.

### Property 1: Reconciliation completeness — no code variable is missing

*For any* set of declared variables (from code/validators) and any `.env.example` entry set, after reconciliation every declared variable either appears in `.env.example` or is reported as `MISSING_IN_ENV_EXAMPLE`; none is silently dropped.

**Validates: Requirements 1.1, 1.3, 1.4, 2.1**

### Property 2: Orphan detection is exhaustive

*For any* `.env.example` entry set and declared-variable set, every `.env.example` entry whose name has no consumer in the declared set is reported as `ORPHANED_ENV_EXAMPLE`, and every entry that does have a consumer is not.

**Validates: Requirements 1.3, 2.1**

### Property 3: Reconciliation missing/orphan symmetry

*For any* declared set D and env-example set E, the reconciliation result's `missingInEnvExample` equals exactly the names in D but not E, and `orphanedInEnvExample` equals exactly the names in E but not D (set-difference symmetry, no overlap, no omission).

**Validates: Requirements 1.3, 1.4**

### Property 4: Authority chain forbids unrecognized declarations

*For any* reconciled inventory, no variable exists in the final `.env.example` shape unless it is present in the declared (code/validator) set or explicitly annotated as justified; an unrecognized declaration always produces a finding.

**Validates: Requirements 1.3, 2.1**

### Property 5: No real secret in produced artifacts

*For any* generated inventory report and `.env.example` output, every `SECRET`-kind variable's emitted value matches the safe-placeholder shape and never matches a real-secret pattern.

**Validates: Requirements 1.5, 2.2, 2.4, 6.2**

### Property 6: Public/secret boundary holds by classification

*For any* catalog of variables, if a variable is classified `SECRET` then it never appears on the `MOBILE` surface and is never emitted as `EXPO_PUBLIC_*`; and any variable on the `MOBILE`/client surface is classified `PUBLIC`. A `SECRET` on the client surface always yields a blocking `SECRET_ON_CLIENT` finding.

**Validates: Requirements 3.2, 3.5**

### Property 7: Mis-prefixed secret is caught by classification not naming

*For any* variable whose name carries the `EXPO_PUBLIC_` prefix but whose classification is `SECRET`, the boundary check produces a blocking finding rather than accepting it as safe.

**Validates: Requirements 3.2, 3.5**

### Property 8: AI surface holds no storage credentials

*For any* catalog, no variable classified as an object-storage credential (MinIO/S3 access/secret keys) is assigned to the `AI` surface.

**Validates: Requirements 3.3**

### Property 9: requiredScope matches the validator

*For any* variable a fail-fast validator asserts as required, the inventory's `requiredScope` includes `runtime`, and its `.env.example` documentation is marked required; conversely a variable with a validator-backed default is not marked runtime-required.

**Validates: Requirements 2.5, 5.2**

### Property 10: Exposure scan flags any real secret in a tracked artifact

*For any* set of tracked files, if any file is a runtime env file or contains a real-secret pattern (excluding `.env.example` placeholders), the scanner produces a blocking `SECRET_EXPOSURE` finding and the report's `compliant` flag is `false`; and the scan never mutates, moves, or rotates the file.

**Validates: Requirements 1.6, 6.3**

### Property 11: Compliance requires zero blocking findings

*For any* inventory report, `compliant` is `true` if and only if the report contains no blocking finding (`SECRET_EXPOSURE`, `SECRET_ON_CLIENT`).

**Validates: Requirements 1.6, 3.5**

## Error Handling

- **Scanner cannot read a source (missing file, parse error):** fail loudly with the file path and reason; never silently skip a source, which would let a variable escape the inventory. Partial inventories are never emitted as authoritative.
- **Reconciliation drift (missing/orphan/required-mismatch):** these are *findings*, not crashes — reported in the report and (in CI) cause a non-zero exit so drift blocks merge.
- **`SECRET_EXPOSURE` / `SECRET_ON_CLIENT`:** blocking findings. The tooling reports them and sets `compliant = false`; it **never** attempts remediation (no rotate/move/delete). The secret value is never echoed into any output — findings reference the file, line, and matched pattern name, not the captured secret.
- **`git` unavailable (exposure scan):** treat as an error, not a pass. An environment where `git check-ignore`/`git ls-files` cannot run cannot assert hygiene, so the scan reports an inconclusive/blocking result rather than a false "clean".
- **AI/pydantic and NestJS validators remain the runtime enforcement:** this spec does not replace them; if a required value is missing at bring-up, the owning module's `validateXxxConfig()` (or pydantic) throws with a clear message. The inventory only guarantees the documented shape matches those validators.

## Testing Strategy

### Property-based tests (pure reconciliation/classification/scanner logic)

PBT applies to the deterministic core (reconcile, classify, boundary check, exposure classification). Use **fast-check** (already the TypeScript PBT choice in this repo's quality-assurance-pbt spec). Do **not** implement PBT from scratch.

- Each of Properties 1–11 is implemented by a **single** property-based test.
- Minimum **100 iterations** per property.
- Each test is tagged: `// Feature: secrets-inventory, Property {n}: {property text}`.
- Generators produce arbitrary `ConfigVariable[]`, arbitrary `.env.example` entry sets (including overlapping/disjoint name sets), mis-prefixed secrets, and synthetic file lists with/without secret patterns — so edge cases (empty sets, duplicate names, all-secret catalogs, whitespace placeholders) are covered by generation, not hand-written cases.
- For Property 10, the exposure scanner is tested against a **temp fixture repo** with mocked `git` output so no real credential is ever involved and the "never mutates" invariant is asserted (file bytes unchanged before/after).

### Example-based unit tests

- Parser: `.env.example` sectioning and comment extraction on representative fixtures (including the real section headers used in the committed file).
- Classifier heuristics: concrete cases for `STRIPE_SECRET_KEY` (SECRET), `EXPO_PUBLIC_RC_IOS_KEY` (PUBLIC), `CHAT_MESSAGE_MAX_LENGTH` (CONFIG).
- `requiredScope` mapping: `CENTRIFUGO_TOKEN_SECRET` (runtime-required per `validateChatConfig`) vs `CHAT_HISTORY_PAGE_SIZE` (has default → not runtime-required).

### Integration tests (against the real repo)

These verify the tooling wired to the actual codebase (1–3 representative runs, not 100 iterations — behavior does not vary meaningfully with input):

- **Reconciliation over the real tree:** run the scanner against `services/api/src/**/*.constants.ts`, the AI pydantic config, `docker-compose*.yml`, and the committed `.env.example`; assert zero `MISSING_IN_ENV_EXAMPLE` and zero unjustified `ORPHANED_ENV_EXAMPLE` after the reconciled `.env.example` is produced. This is the deliverable's acceptance gate.
- **Boundary audit over the real catalog:** assert no `SECRET_ON_CLIENT` finding and that the AI surface has no storage credential.
- **Exposure/hygiene over the real repo:** `git check-ignore` confirms `.env*` are ignored; tracked-file scan confirms no runtime env file is tracked; secret-pattern scan over tracked files (excluding `.env.example`) is clean — or, if not, the run reports `SECRET_EXPOSURE` and fails, as designed.

### CI wiring

A CI job (`config-inventory`) runs the reconciliation + boundary + exposure checks and fails the build on any blocking finding or drift, keeping the inventory a *maintained* artifact rather than a one-off snapshot.

### Documentation deliverables (verified by review, not tests)

- `docs/CONFIGURATION-INVENTORY.md` created and referenced from the deployment docs.
- `docs/ARCHITECTURE.md` gains a "Configuration Surfaces" note + a Mermaid diagram of the API/AI/MOBILE/INFRA surfaces and the public/secret boundary.
- `docs/ADR/010-configuration-inventory-and-secret-boundary.md` records the configuration-inventory + public/secret-boundary + no-rotation-this-iteration decisions.
- `docs/CHANGELOG.md` gains an entry under `## [Unreleased]`.
- The bring-up runbook (copy `.env.example` → env per surface → fill operator values → `docker compose up` infra → start services so validators run → adapt until validators pass) is documented in the inventory doc, reproducible for local and VPS, noting operator-supplied vs infra-generated values.

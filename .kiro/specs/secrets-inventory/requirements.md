# Requirements Document

## Introduction

The `secrets-inventory` module produces the **single, complete inventory of every configuration value, credential, API key, and secret** BidClean needs to run — across the API (NestJS), the AI service (FastAPI), the mobile app (Expo), and the self-hosted infrastructure — so the project can be **stood up and correctly configured** in local, staging, and the VPS. It is a **meta / operational spec** (not a product feature) that comes after all feature specs (1–25) are written, because only then is the full set of variables known. Its job is to **consolidate, document, categorize, and wire** configuration — so that "bring the project up and fill in the variables" is a deterministic, checklisted task rather than a scavenger hunt.

**Explicit scope for this iteration (per the operator's direction): inventory + bring-up + adaptation, NOT rotation.** This spec does NOT rotate, revoke, regenerate, move, or stage any existing credential. The operator will supply the actual credential values; this spec's job is to know exactly what values are needed, where each goes, how they are grouped, and how the app consumes them — then help stand the system up and adapt the variables.

**But a discovered existing secret exposure is REPORTED, not silently accepted.** There is a real tension: "do not touch existing secrets" vs "no committed artifact contains a real secret". This spec resolves it without rotating anything: if the inventory discovers a real secret already present in a committed/tracked artifact, it records a `SECRET_EXPOSURE = FOUND` finding, **reports it, and does NOT mark the configuration as compliant** — while still not touching, moving, or rotating the secret. Rotation/remediation is deferred to separate secrets-security work. So a project with an exposed credential can never *pass* this spec as "correctly configured"; the exposure is a blocking finding, but the fix is out of scope here.

**It consolidates what the feature specs already declared.** Every spec we wrote introduced its own configuration surface with a fail-fast validator (`validateChatConfig`, `validateVoiceNotesConfig`, `validateVoipConfig`, `validateNotificationsConfig`, `validateServiceTrackingConfig`, `validateVideoVerificationConfig`, `validateChecklistPhotosConfig`, `validateServiceCompletionConfig`, `validateDisputeConfig`, `validateFavoritesConfig`, plus the Sprint 1–3 config for auth/roles/KYC/profile/offers/escrow/commission/subscriptions/ads). The current `.env.example` already covers Sprints 1–3 + chat (~269 lines, sectioned by module). This spec's inventory is the **superset**: it reconciles the existing `.env.example` with every variable the later specs (voice-notes → quality-assurance-pbt) declared, so nothing is missing and nothing is orphaned.

**Authority split (kept clear):**
- **The code is the source of truth for which variables exist.** A variable is "real" because some module reads it (via its config/validator). The inventory is derived from and reconciled against the code + each spec's declared config, never invented.
- **`.env.example` is the source of truth for the shape** (names, grouping, which are required vs optional, safe placeholder/default values). It documents every variable with a placeholder — never a real secret.
- **The runtime environment (local `.env`, VPS env, Vault) is the source of truth for the actual values.** Real credentials live there, supplied by the operator; they are never committed. The mobile app only ever receives `EXPO_PUBLIC_*` (public) values.
- **This spec owns the inventory + the bring-up runbook + variable adaptation.** It does not own the feature behavior behind each variable (that stays in the owning spec) and it does not own the live deployment/health validation (that is `full-audit`/deployment-readiness).

**Deliberate scope boundaries:**
- **No rotation / no secret relocation in this iteration.** Documented and deferred; this spec neither rotates nor moves any existing credential.
- **Inventory + documentation + bring-up wiring only.** It produces the complete variable catalog, a reconciled `.env.example`, per-surface grouping (API / AI / mobile / infra), required-vs-optional classification, and a bring-up runbook. It does not implement new feature behavior.
- **Public vs secret is a hard boundary.** Client-shippable config is `EXPO_PUBLIC_*` (public app id, public URLs) only; server secrets (API keys, signing secrets, DB/Redis/MinIO/Keycloak credentials, Stripe/RevenueCat/OneSignal/Bedrock secrets) never reach the client and never appear as `EXPO_PUBLIC_*`.
- **Fail-fast is the enforcement.** Missing/invalid required config fails at startup via each module's existing validator; this spec ensures the inventory matches those validators so a misconfigured bring-up fails loudly, not silently.
- **Multi-environment, multi-country aware.** The inventory distinguishes local / staging / production (VPS) values and captures the per-country config (currencies, commissions, payment methods) that the plan requires, without hardcoding.
- **This is not the live audit.** Verifying that the configured services are actually reachable and healthy in the running VPS is `full-audit`/deployment-readiness; here we ensure the *values are known, grouped, documented, and wired*.

## Domain Model Overview

```
WHAT COUNTS — "external configuration input" (the inventory's precise scope):
   IN  = any value EXTERNAL to the code that can alter runtime or build behavior AND is read by an
         application surface, a service, docker-compose, CI/build config, or a validator
         (env vars, EXPO_PUBLIC_* build vars, docker-compose/CI vars, provider keys/secrets, bootstrap values)
   OUT = internal constants, derived/computed values, temporary locals, third-party library internals,
         and anything not externally supplied — these are NOT inventory entries

AUTHORITY CHAIN (one-directional — no ambiguity about who owns what):
   CODE / VALIDATORS   ──authoritative EXISTENCE──►  a variable is "real" iff some surface/validator reads it
        │
        ▼
   INVENTORY           ──generated/reconciled artifact──►  the single catalog derived from the above
        │
        ▼
   .env.example        ──developer-facing SHAPE──►  names/groups/placeholders; MAY NOT declare a variable
        │                                            that CODE/VALIDATORS do not recognize
        ▼
   RUNTIME ENV / Vault ──actual VALUES──►  real credentials, operator-supplied, never committed

feature specs (1–25) + existing code — each declares its config surface + fail-fast validator
        │  reconciled into
        ▼
configuration inventory (the single catalog — derived from code, not invented)
   per variable: { name, surface(API|AI|MOBILE|INFRA), group(module), kind(SECRET|CONFIG|PUBLIC),
                   requiredScope(runtime|build|deploy|infra|environment-specific — NOT a bare bool),
                   env(local|staging|prod applicability), placeholder/default,
                   consumed_by (module/validator), notes }
        │  materialized as
        ▼
.env.example (source of truth for SHAPE — every var, placeholder only, sectioned by module/surface)
   + per-surface views:  API env · AI env · mobile EXPO_PUBLIC_* env · infra (docker-compose) env

surfaces & where values live at runtime (NOT committed):
   API (NestJS)      → server .env / VPS env / Vault   (DB, Redis, MinIO, Keycloak, Stripe, RevenueCat,
                                                         OneSignal, Bedrock, Centrifugo, LiveKit secrets…)
   AI (FastAPI)      → its own env                       (model/config; NO storage creds — Option A)
   mobile (Expo)     → EXPO_PUBLIC_* only                (public app ids + public URLs; NEVER secrets)
   infra (compose)   → service env                       (Postgres/Redis/MinIO/Keycloak/Centrifugo/LiveKit
                                                          /Traefik/monitoring bootstrap values)

public/secret boundary (hard):
   PUBLIC  → EXPO_PUBLIC_ONESIGNAL_APP_ID, EXPO_PUBLIC_*_URL, public map style, etc.
   SECRET  → *_API_KEY, *_SECRET, *_PASSWORD, signing secrets, service-account JSON, shared secrets
   a SECRET SHALL never be exposed as EXPO_PUBLIC_* nor shipped to the client

variable families to consolidate (superset of current .env.example + specs 14–25):
   infra:   DATABASE_*, REDIS_*, MINIO_*, KEYCLOAK_*, CENTRIFUGO_*, LIVEKIT_*, TRAEFIK/monitoring
   payments/monetization: STRIPE_*, PAYMENTS_*, REVENUECAT_*, ADS_*
   comms:   ONESIGNAL_*, LIBRETRANSLATE_*, chat CHAT_*, VOICE_*, VOIP_*, notifications NOTIFICATIONS_*
   service exec: SERVICE_* (tracking), VIDEO_VERIFICATION_*, CHECKLIST_PHOTO_*, service-completion SERVICE_AUTO_RELEASE_*
   sprint6: DISPUTE_*, FAVORITES_*  (theme/samsung are mobile — EXPO_PUBLIC_* only)
   ai:      AWS Bedrock / model config
   cross-cutting: API_*, rate limiting, default country/language, per-country config

bring-up runbook (deterministic, no rotation):
   1. copy .env.example → .env (per surface)          2. operator fills provided values
   3. docker compose up infra                          4. each module's validateXxxConfig() runs (fail-fast)
   5. adapt/adjust variables until validators pass      6. services are CONFIGURED AND STARTUP-VALID
   (result = "configured + startup-valid", NOT "operational/healthy" — health/liveness is full-audit)
   (rotation / secret relocation → OUT OF SCOPE, deferred)
   (SECRET_EXPOSURE = FOUND anywhere → blocking finding: reported, config NOT compliant, secret untouched)
```

- The **inventory is derived from code + specs**, materialized as a reconciled `.env.example` (shape only, placeholders) plus per-surface views (API / AI / mobile / infra).
- The **public/secret boundary is hard**: only `EXPO_PUBLIC_*` reaches the client; every secret stays server/infra-side; the AI service holds no storage credentials (Option A).
- **Fail-fast validators** (already in each module) are the enforcement — the inventory is reconciled against them so a missing required value fails at startup, loudly.
- **No rotation in this iteration** — the operator supplies values; this spec inventories, documents, brings up, and adapts.

## Glossary

- **Configuration inventory** — the single catalog of every variable `{ name, surface, group, kind, required, env applicability, placeholder, consumed_by }`, derived from code + specs.
- **Surface** — where a variable belongs: API (NestJS), AI (FastAPI), MOBILE (Expo `EXPO_PUBLIC_*`), or INFRA (docker-compose services).
- **Kind** — `SECRET` (never client-side, never committed real), `CONFIG` (non-secret tunable), or `PUBLIC` (`EXPO_PUBLIC_*`, client-safe).
- **Required vs optional** — whether a fail-fast validator rejects startup without it (required) or a sensible default applies (optional).
- **`.env.example`** — the committed source-of-truth for variable *shape*: every variable, placeholders only, sectioned; never a real secret.
- **Fail-fast validator** — a module's `validateXxxConfig()` that throws at startup on missing/invalid required config; the enforcement the inventory reconciles against.
- **Public/secret boundary** — the hard rule that only `EXPO_PUBLIC_*` reaches the client and no secret ever does.
- **Bring-up runbook** — the deterministic steps to configure and start the system from the inventory, without rotating anything.
- **Rotation (out of scope)** — regenerating/revoking/relocating a credential; explicitly deferred in this iteration.

## Requirements

### Requirement 1 — Complete, code-derived configuration inventory

**User Story:** As an operator, I want one complete list of every variable the project needs, so that I can configure it fully without hunting through code.

#### Acceptance Criteria

1. WHEN the inventory is produced THEN it SHALL enumerate every **external configuration input** — defined as a value external to the code that can alter runtime or build behavior AND is read by an application surface, a service, docker-compose, CI/build config, or a validator — derived from the code + each spec's declared config/validator (the superset of the current `.env.example` and all variables declared by specs 14–25). It SHALL explicitly EXCLUDE internal constants, derived/computed values, temporary locals, and third-party library internals (those are not inventory entries).
2. WHEN each variable is catalogued THEN it SHALL record `{ name, surface, group(module), kind(SECRET|CONFIG|PUBLIC), requiredScope, env applicability, placeholder/default, consumed_by }`, where **`requiredScope ∈ { runtime, build, deploy, infra, environment-specific }`** — not a bare boolean — because a variable can be required for production but not local, required at build-time (e.g. an Expo public token) without a runtime validator, or required only by infra/CI.
3. WHEN the inventory is reconciled THEN it SHALL follow the authority chain **CODE/VALIDATORS → INVENTORY → `.env.example` → RUNTIME ENV**: code/validators are authoritative for a variable's *existence*; the inventory is the generated catalog; `.env.example` is the developer-facing *shape* and MAY NOT declare a variable that code/validators do not recognize. Any variable a module reads but missing from `.env.example` SHALL be added; any `.env.example` entry no code reads SHALL be flagged orphaned (removed or justified).
4. WHEN the inventory is complete THEN it SHALL have no gaps: every fail-fast validator's required keys appear in the inventory, and every inventory SECRET/CONFIG maps to a real consumer.
5. WHEN the inventory is presented THEN it SHALL NOT contain any real secret value — only names, classifications, and safe placeholders.
6. WHEN the inventory discovers a real secret value already present in a committed/tracked artifact THEN it SHALL record a `SECRET_EXPOSURE = FOUND` finding, report it, and NOT mark the configuration as compliant — while NOT touching, moving, or rotating the secret (remediation deferred). An exposed credential is a blocking finding for this spec's completion, even though its fix is out of scope.

### Requirement 2 — Reconciled `.env.example` (shape source of truth), no rotation

**User Story:** As a developer, I want an up-to-date `.env.example` covering everything, so that copying it gives me every variable I must fill.

#### Acceptance Criteria

1. WHEN `.env.example` is updated THEN it SHALL contain every variable from the inventory, grouped by module/surface (extending the existing sectioned format), each with a safe placeholder and a one-line comment on purpose and required/optional.
2. WHEN a variable is a secret THEN its `.env.example` value SHALL be an obvious placeholder (e.g. `CHANGE_ME`), never a real credential, and it SHALL be marked as a server/infra secret (not `EXPO_PUBLIC_*`).
3. WHEN this spec runs THEN it SHALL NOT rotate, revoke, regenerate, move, or stage any existing real credential (including any secret already present anywhere in the repo); rotation/relocation is explicitly out of scope and deferred.
4. WHEN the operator supplies real values THEN they SHALL go into the runtime environment (local `.env`, VPS env, Vault) — never into `.env.example` and never committed.
5. WHEN `.env.example` is reconciled THEN the required-vs-optional classification SHALL match each module's fail-fast validator (a required key is documented as required).

### Requirement 3 — Per-surface grouping and the public/secret boundary

**User Story:** As an operator, I want variables grouped by where they belong and clearly split into secret vs public, so that nothing sensitive leaks to the client.

#### Acceptance Criteria

1. WHEN variables are grouped THEN the inventory SHALL provide per-surface views: API (NestJS) env, AI (FastAPI) env, mobile (Expo) `EXPO_PUBLIC_*` env, and infra (docker-compose) env.
2. WHEN a value is client-shippable THEN it SHALL be `EXPO_PUBLIC_*` (public app ids, public URLs, public map style) only; a SECRET SHALL NEVER be exposed as `EXPO_PUBLIC_*` or shipped to the mobile client. Safety SHALL be verified by **classification + bundle exposure**, not by naming alone: a value that reaches the client bundle SHALL be explicitly classified `PUBLIC` (the `EXPO_PUBLIC_` prefix by itself does NOT prove a value is safe) — so a mis-prefixed secret is caught, not trusted because of its name.
3. WHEN the AI service is configured THEN it SHALL hold NO object-storage credentials (Option A across voice-notes/video-verification) — the inventory SHALL reflect that the AI surface has no MinIO secrets.
4. WHEN infra services are configured THEN their bootstrap values (Postgres/Redis/MinIO/Keycloak/Centrifugo/LiveKit/Traefik/monitoring) SHALL be catalogued under the INFRA surface for docker-compose.
5. WHEN the boundary is verified THEN the inventory SHALL make it auditable that every SECRET is server/infra-side and no secret is in the mobile/public surface.

### Requirement 4 — Multi-environment & multi-country configuration

**User Story:** As an operator, I want the config to distinguish environments and countries, so that local/staging/VPS and each market are configurable without code changes.

#### Acceptance Criteria

1. WHEN a variable differs by environment THEN the inventory SHALL note its applicability (local / staging / production-VPS) and any environment-specific placeholder guidance, so each environment can be filled correctly.
2. WHEN per-country config is needed THEN the inventory SHALL capture **country-specific configuration parameters and compliance-related flags/settings** (currencies COP/USD/CAD/EUR/GBP, commission rates, enabled payment methods, and compliance toggles) as configuration, not hardcoded literals. It SHALL NOT absorb regulatory/business *logic* — that stays in its owning module; the inventory only catalogues the configurable parameters/flags.
3. WHEN defaults exist THEN optional variables SHALL document their default so an environment can omit them safely; required variables SHALL be clearly required.
4. WHEN staging vs production differ (e.g. sandbox vs live Stripe/RevenueCat keys) THEN the inventory SHALL make that distinction explicit so a sandbox key is never mistaken for a production key.
5. WHEN the mobile app is configured per environment THEN its `EXPO_PUBLIC_*` values SHALL be environment-appropriate (e.g. staging vs prod URLs) and documented.

### Requirement 5 — Bring-up runbook & fail-fast reconciliation

**User Story:** As an operator, I want a deterministic runbook to stand the project up and adapt variables, so that configuration is a checklist, not guesswork.

#### Acceptance Criteria

1. WHEN the runbook is produced THEN it SHALL give deterministic steps: copy `.env.example` → env per surface, fill operator-supplied values, `docker compose up` the infra, start each service so its `validateXxxConfig()` runs, adapt variables until all validators pass.
2. WHEN a required value is missing/invalid THEN the corresponding module's fail-fast validator SHALL reject startup with a clear message (this spec ensures the inventory matches those validators so failures are loud, not silent).
3. WHEN the runbook adapts variables THEN it SHALL do so by editing the runtime env (not `.env.example`, not code) and SHALL NOT rotate or relocate any secret.
4. WHEN bring-up completes THEN every surface (API, AI, mobile config, infra) SHALL have its required variables satisfied and its validators passing — a **configured and startup-valid** system. This is explicitly NOT the same as "operational/healthy": config being valid ≠ dependencies reachable ≠ service actually healthy. Liveness/health/connectivity of the deployed VPS is `full-audit`/deployment-readiness, not this spec.
5. WHEN the runbook is documented THEN it SHALL be reproducible for local and VPS, noting which values are operator-supplied vs generated-by-infra (e.g. a service that generates its own key on first run).

### Requirement 6 — Documentation, security hygiene, and standards

**User Story:** As a maintainer, I want the inventory documented and safe, so that configuration stays correct and no secret leaks.

#### Acceptance Criteria

1. WHEN the inventory is documented THEN it SHALL live as a maintained artifact (a secrets/config inventory doc + the reconciled `.env.example`), referenced from the deployment docs, kept in sync as specs evolve.
2. WHEN documentation is produced THEN it SHALL NOT contain any real secret value; examples use placeholders; the doc explains where real values live (env/Vault) and the public/secret boundary.
3. WHEN `.gitignore`/hygiene is verified THEN it SHALL be an actual verification, not just "the `.gitignore` mentions `.env`": it SHALL run `git check-ignore` on the runtime env files, a **tracked-file scan** (a file listed in `.gitignore` can still already be tracked), and a **secret-pattern scan** — and any tracked env file or matched secret pattern SHALL surface as a `SECRET_EXPOSURE`/hygiene finding (reported, not rotated, per Req 1.6). Observing existing state only; nothing is moved.
4. WHEN a variable has business meaning THEN it SHALL be a named config value (consistent with no-hardcoded-values), and the inventory SHALL reference the constant/validator that consumes it.
5. WHEN the spec is introduced THEN it SHALL be documented (the inventory doc, ARCHITECTURE note on configuration surfaces, CHANGELOG, and an ADR for the configuration-inventory + public/secret-boundary + no-rotation-this-iteration decisions) per the project documentation rules.

## Correctness Properties (business invariants)

- **REQ-SI1 — Inventory is complete, code-derived, and precisely scoped.** Every *external configuration input* (value external to code that alters runtime/build and is read by a surface/service/compose/CI/validator) is in the inventory (superset of current `.env.example` + specs 14–25); internal constants/derived values/locals/library internals are excluded; every validator's required keys appear; no orphans. *(Req 1.1, 1.3, 1.4)*
- **REQ-SI1b — Authority chain is one-directional.** CODE/VALIDATORS own existence → INVENTORY (generated) → `.env.example` (shape, may not declare an unrecognized variable) → RUNTIME ENV (values). *(Req 1.3)*
- **REQ-SI1c — `requiredScope`, not a bare boolean.** Each variable's necessity is expressed as `runtime|build|deploy|infra|environment-specific`, so prod-only / build-time / infra-only requirements are represented correctly. *(Req 1.2, 2.5)*
- **REQ-SI2 — No real secret in committed artifacts.** Neither the inventory nor `.env.example` contains a real credential — placeholders only; real values live in runtime env/Vault, never committed. *(Req 1.5, 2.2, 2.4, 6.2)*
- **REQ-SI3 — No rotation this iteration; exposure is a blocking finding.** Nothing rotates/revokes/regenerates/moves/stages any existing credential (deferred); BUT a real secret found in a committed/tracked artifact is recorded as `SECRET_EXPOSURE = FOUND`, reported, and the config is NOT marked compliant — the secret is left untouched, remediation deferred. *(Req 1.6, 2.3, 5.3, 6.3)*
- **REQ-SI4 — Hard public/secret boundary, verified by classification not naming.** Only `EXPO_PUBLIC_*` reaches the client; every SECRET is server/infra-side; the AI surface holds no storage creds (Option A); a client-bundle value must be explicitly classified PUBLIC (the prefix alone doesn't prove safety); auditable in the inventory. *(Req 3.2, 3.3, 3.5)*
- **REQ-SI5 — `.env.example` matches validators.** Required-vs-optional in `.env.example` matches each module's fail-fast validator, so a documented-required key really is required and bring-up fails loudly if missing. *(Req 2.5, 5.2)*
- **REQ-SI6 — Per-surface grouping.** The inventory yields API / AI / mobile / infra views so each environment is filled correctly per surface. *(Req 3.1, 3.4)*
- **REQ-SI7 — Multi-env & multi-country aware.** Environment applicability (local/staging/prod) and per-country config (currencies/commissions/methods) are captured as configuration, sandbox vs live distinguished. *(Req 4.1, 4.2, 4.4)*
- **REQ-SI8 — Deterministic bring-up.** A documented runbook takes the system from `.env.example` → filled env → infra up → validators passing → startable, by adapting variables only (no rotation). *(Req 5.1, 5.4, 5.5)*
- **REQ-SI9 — Ends at "configured & startup-valid", not "healthy".** This spec ends at configured + validators-passing (startup-valid); config-valid ≠ dependencies-reachable ≠ service-healthy — verifying the deployed VPS is reachable/healthy/connected is `full-audit`/deployment-readiness. *(Introduction scope, Req 5.4)*
- **REQ-SI10 — Maintained + standards-compliant.** The inventory is a maintained artifact (not a one-off), documented with an ADR, git-ignore hygiene confirmed, and every business-meaningful value is named config (no-hardcoded-values). *(Req 6.1, 6.3, 6.4, 6.5)*

## Non-Goals

- Rotating, revoking, regenerating, moving, or staging any existing credential (including any secret already committed) — explicitly deferred this iteration.
- Verifying the deployed system is reachable/healthy/connected in the running VPS — that is `full-audit`/deployment-readiness.
- Implementing new feature behavior — the behavior behind each variable stays in its owning spec; this spec only inventories/wires configuration.
- Choosing or changing the secret store — it documents where values live (env/Vault) but does not migrate secrets into a store this iteration.
- Putting any secret into the mobile/public surface — only `EXPO_PUBLIC_*` client values, never a secret.
- Committing real values anywhere — `.env.example` is placeholders only; real values live in runtime env/Vault.
- Being a one-off snapshot — the inventory and `.env.example` are maintained as specs evolve.

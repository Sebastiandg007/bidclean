# Requirements Document

## Introduction

The `full-audit` (deployment-readiness) module is the **final gate before the system goes live**: it verifies that the *whole assembled system* — backend (NestJS), AI service (FastAPI), mobile app (Expo), and all self-hosted infrastructure — is actually **built, deployed, wired together, reachable, and functional end-to-end**, first in a local Docker environment and then on the VPS, and that the mobile app is **submission-ready** for the stores. It is the last meta-spec, run after every feature is implemented (Specs 1–25), the correctness is verified (`quality-assurance-pbt`), and the configuration is inventoried and startup-valid (`secrets-inventory`). Its purpose is exactly the operator's ask: *validate every component — backend, frontend, DevOps, engineering — that everything is well, integrated, connected, and fully functional* before packaging and shipping.

**It verifies the LIVE, ASSEMBLED system — distinct from its two neighbors.** The boundary is deliberate and must stay clean:
- `quality-assurance-pbt` (Spec 25) verifies **code correctness** (properties, PBT, unit/integration) against infra it stands up *for testing*.
- `secrets-inventory` leaves the system **configured and startup-valid** (all validators pass, variables filled).
- `full-audit` verifies the **deployed system is alive, integrated, connected, and operational-for-readiness** — every service up and healthy, every inter-service edge actually reachable, the critical journeys working against the *running* system, first locally then on the VPS, and the mobile app ready to submit. Config-valid ≠ reachable ≠ healthy ≠ end-to-end-functional; this spec closes that last gap.

**"Operational-for-readiness", not "production-reliability-proven".** To keep this spec out of ongoing SRE/observability, `operational` here means a bounded, point-in-time bar: **healthy + reachable + critical journeys functional** at audit time. It does NOT mean sustained production reliability is proven — that is the job of ongoing monitoring (which full-audit only verifies is *wired*).

**Live-money is never triggered by the automatic audit.** External-payment edges are validated in three explicitly-separated modes so the audit can never fire a real financial operation just to "prove Stripe works": **VPS + sandbox** (automatic E2E), **VPS + live-readiness probes** (non-transacting checks that live integrations are reachable/authenticated), and **VPS + operator-controlled live-money validation** (a real transaction) — the last is **manual, operator-gated, and NEVER part of the automatic readiness E2E**.

**It is a validation + readiness pass, not new behavior and not re-testing units.** full-audit adds health checks, connectivity probes, live smoke/E2E against the running stack, an integration-completeness audit (every component present and wired), and a deployment/submission checklist. It does **not** re-run the unit/property suites (that is Spec 25's job, referenced not duplicated), does **not** implement or change feature behavior, and does **not** rotate secrets (that stayed out of `secrets-inventory`). Defects it finds are fixed in the owning feature; missing config is fixed via `secrets-inventory`; a failing property is fixed via the owning spec + Spec 25.

**Two-environment discipline: local first, then VPS.** The plan is explicit: *"una cosa es que funcione en local pero una completamente diferente a lo que está en live en la VPS"*. So full-audit runs the same audit twice with the same criteria: (1) **local** — the full Docker Compose stack on the dev machine, everything green, journeys pass; then (2) **VPS** — the same stack deployed behind Traefik with real domains/SSL, everything green *in the live environment*, because passing locally does not prove the deployed system is correct. A component that works locally but is unreachable/misconfigured on the VPS is a blocking finding.

**Authority split (kept clear):**
- **Each owning spec/module remains the source of truth for behavior + config + correctness.** full-audit *observes and verifies* the running system; it never redefines behavior, never invents config, never weakens a property. A discrepancy is a finding routed to the owner, not fixed here.
- **The running deployment is the subject under audit.** Truth about "is it up / reachable / healthy / connected" comes from probing the live system (health endpoints, connectivity checks, live journeys), not from reading code or config.
- **The readiness checklist is the auditable artifact.** A single, maintained checklist enumerates every component, every inter-service edge, every external integration, every store-submission requirement — each with a pass/fail probe — so "ready to ship" is a checklist state, not an opinion.
- **This spec gates packaging/shipping; it does not itself publish.** It declares readiness (local green → VPS green → store artifacts ready); the actual store submission and VPS deploy actions are operator-executed (and, for Android/Galaxy, subject to the store's own review), guided by this checklist.

**Deliberate scope boundaries:**
- **Liveness/integration/readiness only — no new features, no unit-suite re-run.** It probes the assembled system and audits completeness; it references Spec 25's results rather than re-executing them.
- **No secret rotation, no secret handling beyond verifying presence/reachability.** It confirms a service can authenticate/connect using the configured credentials; it never rotates, prints, or relocates a secret (consistent with `secrets-inventory`). A `SECRET_EXPOSURE` finding from `secrets-inventory` is carried forward as a blocking readiness finding, not remediated here.
- **Local + VPS environments; external services via their real sandbox/live per environment.** Local audit may use sandbox external services; the VPS audit uses the environment's configured (sandbox or live) integrations — never real money in a test, and any live-money path is validated only with the operator's explicit, controlled action.
- **Store submission readiness, not the review outcome.** It verifies the app builds, the store artifacts exist (icons, screenshots incl. unfolded, listing metadata, AAB/IPA, ratings, privacy), and store technical requirements are met; it cannot guarantee the store *approves* the app.
- **Findings are reported and gate readiness; they are not silently patched.** A missing component, a dead edge, an unhealthy service, or an unmet store requirement blocks "ready" and is routed to its owner.
- **Not a substitute for monitoring.** It is a point-in-time readiness audit; ongoing production monitoring (Prometheus/Grafana/Loki/Sentry/Uptime Kuma) is operated separately (though full-audit verifies those are wired).

## Domain Model Overview

```
inputs (all prerequisites, referenced not re-done):
   Specs 1–25 implemented · quality-assurance-pbt green (code correct) · secrets-inventory
   (configured + startup-valid, exposure findings carried forward)
        │  audited by
        ▼
component registry (versioned — the verifiable definition of "every component"):
   per component: { componentId, owner, surface(API|AI|MOBILE|INFRA), entryPoint, dependencies,
                    requiredInEnvironment(local|vps|both), healthProbe, integrationProbe }
   includes NOT just services but internal modules: Nest modules, BullMQ workers, event/outbox consumers,
   scheduled jobs, webhook ingresses, AI endpoints, mobile feature modules, notification consumers
        │  drives
        ▼
readiness checklist (the single maintained auditable artifact — every item is PASS | FAIL | N/A)
   each item = { invariant (expected condition — SAME across environments),
                 environment-specific probe (HOW it's checked — MAY differ local vs VPS),
                 mandatory(bool), status(PASS|FAIL|N/A), applicabilityJustification (required when N/A) }
   COMPONENT PRESENCE:  API · AI · mobile build · Postgres+PostGIS · Redis · MinIO · Keycloak ·
                        Centrifugo · LiveKit · LibreTranslate · Whisper · Piper · Traefik ·
                        Prometheus/Grafana/Loki · Sentry · (each: present + up)
   SERVICE HEALTH:      each service exposes/【has a probed】 health/readiness → GREEN
   INTER-SERVICE EDGES: API→Postgres, API→Redis/BullMQ, API→MinIO, API→Keycloak(JWKS),
                        API→Centrifugo(publish), API→LiveKit(token/webhook), API→AI(/transcribe,
                        /verify-face), API→Stripe, API→RevenueCat, API→OneSignal, API→Bedrock,
                        mobile→API, mobile→Centrifugo(WS), mobile→LiveKit(media), mobile→MinIO(presigned)
                        (each edge: actually reachable + authenticated, not just configured)
   EXTERNAL INTEGRATIONS: Stripe / RevenueCat / OneSignal / Mapbox / Bedrock reachable per environment
   LIVE JOURNEYS:       the critical E2E journeys (Spec 25's A–E + favorites-first) run against the
                        RUNNING system (not mocks) and pass
   STORE READINESS:     Android AAB + Galaxy build valid (Samsung reqs), iOS build, icons, screenshots
                        (incl. unfolded), listing metadata, content rating, privacy — present + valid
   DEVOPS READINESS:    Traefik SSL/domains, backups configured, monitoring wired, CI green on HEAD

audit runs TWICE, SAME INVARIANTS, environment-appropriate probes:
   (1) LOCAL   — full docker compose stack on dev machine
   (2) VPS     — same stack behind Traefik w/ real domains+SSL
   each item's INVARIANT is the same in both; its PROBE may differ (localhost endpoint vs public subdomain);
   items only meaningful in one environment (real certs, prod domains, VPS routing) are N/A elsewhere
   with an applicability justification — NOT forced GREEN and NOT silently skipped.
   a mandatory+applicable item PASS locally but FAIL on VPS = blocking finding (parity required)

external-payment validation modes (money never auto-triggered):
   VPS + sandbox                     → automatic readiness E2E (no real money)
   VPS + live-readiness probes       → non-transacting reachability/auth checks of live integrations
   VPS + operator live-money         → a real transaction: MANUAL, operator-gated, NOT in the automatic E2E

finding lifecycle (reported, routed, never silently patched):
   FAIL item → finding { component/edge, environment(local|vps), evidence, owner(spec/module) }
             → routed to owner (feature fix / secrets-inventory config / Spec 25 property) → re-audit
   readiness = every MANDATORY + APPLICABLE item is PASS in BOTH environments (N/A justified) + valid store artifacts

gates (this spec declares readiness; operator executes the irreversible actions):
   local PASS → VPS deploy → VPS PASS → package mobile → store submission (operator-executed, guided)
```

- full-audit is driven by **one maintained readiness checklist** where every component, inter-service edge, external integration, live journey, store artifact, and DevOps item has a **pass/fail probe** against the running system.
- It runs the **same audit in two environments** — local Docker then the live VPS — and **requires parity**: green locally is not enough; green-on-VPS is the real bar (a local-only pass is a blocking finding).
- It **verifies edges are actually reachable + authenticated**, not merely configured (config validity is `secrets-inventory`'s job; reachability is this spec's).
- It **reports and routes findings** to their owners and gates packaging/shipping; the operator executes the irreversible deploy/submit actions, guided by the checklist.

## Glossary

- **Readiness checklist** — the single maintained artifact listing every component, edge, integration, live journey, store artifact, and DevOps item, each with a pass/fail probe; the audit's source of truth.
- **Component presence** — a required service exists and is up (API, AI, mobile build, Postgres, Redis, MinIO, Keycloak, Centrifugo, LiveKit, translation/STT/TTS, Traefik, monitoring).
- **Service health** — a service answers a health/readiness probe GREEN (up + internally ok).
- **Inter-service edge** — a directed dependency (e.g. API→Keycloak JWKS) verified to be **actually reachable and authenticated**, not just configured.
- **Live journey** — a critical E2E journey (Spec 25's A–E + favorites-first) executed against the **running** system, not mocks.
- **Environment parity** — the requirement that the audit is GREEN in BOTH local and VPS with the same criteria; local-only green is a blocking finding.
- **Store readiness** — the app builds and all submission artifacts/technical requirements (Android/Galaxy/iOS: AAB/IPA, icons, screenshots incl. unfolded, listing, rating, privacy) are present and valid.
- **DevOps readiness** — Traefik SSL/domains, backups, monitoring wiring, and green CI on HEAD.
- **Finding** — a RED checklist item with evidence, environment, and owner; reported and routed, never silently patched.
- **Readiness** — the terminal state: ALL checklist items GREEN in BOTH environments + valid store artifacts.

## Requirements

### Requirement 1 — Component presence & health (every service up)

**User Story:** As the operator, I want proof that every component of the system is present and healthy, so that nothing is silently missing before launch.

#### Acceptance Criteria

1. WHEN the audit runs THEN it SHALL verify every required component is present and up: API (NestJS), AI (FastAPI), the mobile build, PostgreSQL+PostGIS, Redis, MinIO, Keycloak, Centrifugo, LiveKit, LibreTranslate, Whisper, Piper, Traefik, and the monitoring stack (Prometheus/Grafana/Loki/Sentry/Uptime Kuma).
2. WHEN a component exposes (or can be given) a health/readiness probe THEN the audit SHALL probe it and require PASS (up + internally healthy), recording the evidence. A health probe is a **liveness signal, NOT integration proof** — a `200 OK` on `/health` does not prove the component's edges (Keycloak/MinIO/Redis/AI) work; those are verified separately (Req 2), and the audit SHALL NOT reduce to `GET /health`.
3. WHEN a required component is missing, down, or unhealthy THEN it SHALL be a `FAIL` finding with evidence and its owner, and readiness SHALL NOT be declared.
4. WHEN a component has no native health endpoint THEN the audit SHALL define a minimal liveness probe for it rather than assuming it is up.
5. WHEN component presence is audited THEN each result SHALL be recorded on the readiness checklist as `PASS | FAIL | N/A` per environment (local, VPS), with an applicability justification whenever `N/A`.

### Requirement 2 — Inter-service connectivity (edges actually reachable + authenticated)

**User Story:** As the operator, I want proof that the services actually talk to each other, so that "configured" doesn't hide a dead connection.

#### Acceptance Criteria

1. WHEN the audit runs THEN it SHALL verify each inter-service edge is **actually reachable and authenticated**, not merely configured: API→Postgres, API→Redis/BullMQ, API→MinIO, API→Keycloak (JWKS/token validation), API→Centrifugo (publish), API→LiveKit (token mint + webhook ingress), API→AI (`/transcribe`, `/verify-face`), API→Stripe, API→RevenueCat, API→OneSignal, API→AWS Bedrock; and mobile→API, mobile→Centrifugo (WS), mobile→LiveKit (media), mobile→MinIO (presigned URLs).
2. WHEN an edge requires authentication THEN the probe SHALL confirm the configured credential actually authenticates (e.g. a real signed call succeeds), without printing or rotating the secret.
3. WHEN an edge is unreachable or fails to authenticate THEN it SHALL be a blocking finding with evidence and owner; a merely-configured-but-dead edge SHALL NOT count as ready.
4. WHEN an external integration is environment-specific (sandbox vs live) THEN the probe SHALL exercise the environment's configured integration and SHALL NOT move real money in a test.
5. WHEN connectivity is audited THEN each edge's result SHALL be recorded per environment on the checklist.

### Requirement 3 — Integration completeness audit (every component wired to the whole)

**User Story:** As the operator, I want confirmation that every component is not just up but integrated into the actual system, so that there are no orphaned or unwired pieces.

#### Acceptance Criteria

1. WHEN "every component" is audited THEN "every" SHALL be defined by a **versioned component registry** — `{ componentId, owner, surface, entryPoint, dependencies, requiredInEnvironment, healthProbe, integrationProbe }` — that enumerates not just the top-level services but the internal modules that can be "up but unwired": Nest modules, BullMQ workers, event/outbox consumers, scheduled jobs, webhook ingresses, AI endpoints, mobile feature modules, and notification consumers. The audit SHALL confirm each registry entry is wired into the running system (registered, reachable via its entry point, consuming/emitting its declared events), so "every component is wired" is verifiable against the registry, not an open-ended claim.
2. WHEN the durable event chains are audited THEN the audit SHALL confirm the cross-module flows actually fire end-to-end on the running system (e.g. `offer.matched`→escrow charge, `service_arrived`→video-verification, `checklist_completed`→completion, dispute routing→escrow action, outbox→push).
3. WHEN a component is present but not integrated (deployed but unwired, or an event chain that never fires) THEN it SHALL be a blocking finding routed to its owner.
4. WHEN the audit references correctness THEN it SHALL rely on `quality-assurance-pbt` for code-level property verification (not re-run it) and focus on *system-level integration* being live.
5. WHEN integration completeness is audited THEN it SHALL cover all layers named by the operator: backend, frontend (mobile), AI, DevOps/infra — each confirmed present, wired, and functional.

### Requirement 4 — Live end-to-end journeys against the running system

**User Story:** As the operator, I want the real user journeys to work against the actually-running system, so that I know the product functions, not just its parts.

#### Acceptance Criteria

1. WHEN live journeys run THEN they SHALL execute the critical E2E journeys (Spec 25's A–E + favorites-first) against the **running** assembled system (real services, not mocks), and pass.
2. WHEN a live journey touches money THEN the automatic readiness E2E SHALL use the environment's **sandbox only (no real money)**, even on the VPS; live integrations MAY additionally be checked with **non-transacting live-readiness probes** (reachable/authenticated, no charge); and a **real live-money transaction SHALL be a separate, MANUAL, operator-gated validation that is NEVER part of the automatic audit** — the audit can never fire a real financial operation to prove an integration works.
3. WHEN a live journey fails THEN it SHALL be a blocking finding with evidence, environment, and the owning spec/module.
4. WHEN live journeys run THEN they SHALL cover both Host and Cleaner roles and the full service lifecycle (publish → match → escrow → tracking → verification → checklist → completion/release) plus the dispute and subscription paths.
5. WHEN live journeys pass THEN the result SHALL be recorded per environment; a journey passing locally but failing on the VPS is a blocking finding.

### Requirement 5 — Two-environment parity (local first, then VPS live)

**User Story:** As the operator, I want the audit proven in local AND on the live VPS, so that "works on my machine" is never mistaken for "works in production".

#### Acceptance Criteria

1. WHEN the audit runs THEN it SHALL run twice with the **same invariants** but **environment-appropriate probes**: (1) LOCAL — the full Docker Compose stack on the dev machine, and (2) VPS — the same stack behind Traefik with real domains and SSL. Each checklist item separates its `invariant` (expected condition — identical across environments, e.g. "API authenticates to Keycloak") from its `probe` (HOW it is checked — MAY differ: localhost endpoint vs public subdomain). "Same criteria" means same invariants, not literally identical probes.
2. WHEN the VPS audit runs THEN it SHALL verify the live-environment specifics: real domains resolve, Traefik terminates SSL (valid Let's Encrypt certs), the subdomains (api/ws/rtc/storage/auth) route correctly, and every checklist item is GREEN in the live environment.
3. WHEN a mandatory+applicable checklist item is PASS locally but FAIL on the VPS THEN it SHALL be a blocking finding — environment parity is required, and local success alone SHALL NOT declare readiness. Items only meaningful in one environment (real Let's Encrypt certs, production domains, VPS routing, production monitoring) SHALL be `N/A` in the other with an explicit applicability justification — never forced to PASS and never silently skipped.
4. WHEN the VPS environment is audited THEN it SHALL confirm the production-appropriate configuration (not dev defaults) is in effect (e.g. real URLs, live/sandbox integrations as intended, no debug-only settings).
5. WHEN both environments are GREEN THEN and only then MAY the system be considered deployment-ready (subject to store readiness, Req 6).

### Requirement 6 — Store submission readiness (Android / Galaxy / iOS)

**User Story:** As the operator, I want confirmation the app is submission-ready, so that packaging and shipping to the stores is a checklist, not a scramble.

#### Acceptance Criteria

1. WHEN store readiness is audited THEN it SHALL confirm the mobile app builds from the single Expo codebase into the required artifacts: Android AAB (Play + Galaxy), iOS build, each meeting the store's current technical requirements (target API/64-bit/signing for Android; the applicable iOS requirements).
2. WHEN Galaxy Store readiness is audited THEN it SHALL confirm the Samsung/large-screen requirements from `samsung-optimization` (adaptive layout, unfolded screenshots) and Samsung's current submission requirements are met.
3. WHEN submission artifacts are audited THEN it SHALL confirm presence + validity of: app icon (1024×1024), screenshots (incl. unfolded/large-screen), listing metadata, content rating, privacy policy link, and a **concrete reviewer test path** — a reviewer test account/credentials, seeded test data, a documented entry path, and known constraints — provided to the store **without committing those credentials to the repo** (temporary/expiring reviewer accounts and their rotation are out of this spec's scope but noted).
4. WHEN store readiness is declared THEN it SHALL be readiness, not approval — the audit cannot guarantee the store approves the app; it verifies the app + artifacts meet submission requirements.
5. WHEN store readiness is audited THEN missing/invalid artifacts SHALL be blocking findings, routed to the owning concern (mobile build / samsung-optimization / listing assets).

### Requirement 7 — DevOps, security & monitoring readiness

**User Story:** As the operator, I want the operational safety nets verified, so that the live system is observable, backed up, and secured.

#### Acceptance Criteria

1. WHEN DevOps readiness is audited THEN it SHALL confirm Traefik provides automatic SSL (valid certs) for all subdomains, and the monitoring stack (Prometheus/Grafana/Loki/Sentry/Uptime Kuma) is wired and receiving data. For backups (PostgreSQL dump + MinIO) it SHALL go beyond "a cron exists": it SHALL confirm **a recent successful backup artifact exists and is readable** (backup configured + recent success + artifact readable) — a full disaster-recovery restore test is out of scope, but "configured" alone SHALL NOT count as ready.
2. WHEN CI is audited THEN it SHALL confirm the pipeline is green on HEAD (the project's green-HEAD invariant) and that the CI jobs actually run the intended suites.
3. WHEN security readiness is audited THEN it SHALL confirm TLS in transit, that secrets are server/infra-side (no secret in the client bundle), and that any `SECRET_EXPOSURE` finding carried forward from `secrets-inventory` is surfaced as a blocking readiness finding (not remediated here, but not ignored).
4. WHEN a DevOps/security/monitoring item is missing or misconfigured THEN it SHALL be a blocking finding with owner and environment.
5. WHEN DevOps readiness is audited THEN it SHALL be verified on the VPS (the live target), not only locally.

### Requirement 8 — Findings, reporting, and the readiness gate

**User Story:** As the operator, I want a single clear readiness verdict with actionable findings, so that "ready to ship" is unambiguous.

#### Acceptance Criteria

1. WHEN the audit completes THEN it SHALL produce a single readiness report: the checklist state per environment, every finding `{ item, environment, evidence, owner }`, and an overall verdict (READY / NOT READY).
2. WHEN any mandatory+applicable checklist item is `FAIL` in either environment (or a store artifact is invalid) THEN the verdict SHALL be NOT READY; readiness requires **every mandatory + applicable item to be `PASS` in BOTH environments** (with each `N/A` carrying an explicit applicability justification) + valid store artifacts. An unjustified `N/A` on a mandatory item SHALL itself be a finding (an item cannot be waved to `N/A` to force readiness).
3. WHEN a finding is produced THEN it SHALL be routed to its owner (feature fix / `secrets-inventory` config / `quality-assurance-pbt` property / mobile build / DevOps) — full-audit reports and gates; it does not silently patch behavior or config.
4. WHEN the audit gates shipping THEN it SHALL declare readiness only; the irreversible actions (VPS deploy, store submission, any live-money validation) are operator-executed, guided by the checklist, in the order local-GREEN → VPS-GREEN → package → submit.
5. WHEN the audit is introduced THEN it SHALL be documented (the readiness checklist artifact, a deployment/readiness runbook, ARCHITECTURE note on the audited topology, CHANGELOG, and an ADR for the live-audit + two-environment-parity + report-not-patch decisions) per the project documentation rules.

## Correctness Properties (business invariants)

- **REQ-FA1 — Audits the live assembled system; health ≠ integration.** Truth about up/reachable/healthy/connected comes from probing the running system, never re-derived from code/config; a health probe is a liveness signal only and never substitutes for edge/integration verification (the audit is not reducible to `GET /health`). *(Req 1.2, 2.1, 3.1)*
- **REQ-FA1b — "Every component" is registry-defined.** Completeness is verified against a versioned component registry covering services AND internal modules (workers, consumers, scheduled jobs, webhooks, AI endpoints, mobile feature modules), so "every component is wired" is a checkable claim, not open-ended. *(Req 3.1)*
- **REQ-FA2 — Clean boundary with neighbors.** It does not re-run Spec 25's unit/property suites (references them), does not invent config (that is `secrets-inventory`), and does not rotate secrets; it verifies *liveness/integration/readiness*. *(Introduction, Req 3.4, 7.3)*
- **REQ-FA3 — Edges reachable + authenticated, not just configured.** Every inter-service edge is proven to actually connect and authenticate; a configured-but-dead edge is a blocking finding. *(Req 2.1, 2.2, 2.3)*
- **REQ-FA4 — Integration completeness.** Every component is not just up but wired into the running system, and the durable cross-module event chains actually fire end-to-end. *(Req 3.1, 3.2, 3.3)*
- **REQ-FA5 — Live journeys pass on the running system.** The critical E2E journeys (A–E + favorites-first) pass against real services (not mocks), both roles, full lifecycle + dispute + subscription. *(Req 4.1, 4.4)*
- **REQ-FA6 — Two-environment parity via same-invariant/env-probe + tri-state.** Each item's invariant is identical across local and VPS while its probe may differ; every mandatory+applicable item must be `PASS` in both; environment-only items are `N/A` with justification (never forced PASS, never silently skipped); a local-PASS/VPS-FAIL is a blocking finding; an unjustified `N/A` on a mandatory item is itself a finding. *(Req 5.1, 5.3, 8.2)*
- **REQ-FA7 — Store submission readiness (not approval).** The app builds and all submission artifacts + store technical requirements are valid (Android/Galaxy/iOS incl. unfolded screenshots); readiness ≠ store approval. *(Req 6.1, 6.2, 6.3, 6.4)*
- **REQ-FA8 — DevOps/security/monitoring verified on the VPS.** SSL/domains, backups, monitoring wiring, green-HEAD CI, secrets server-side, and carried-forward `SECRET_EXPOSURE` findings are all verified on the live target. *(Req 7.1, 7.2, 7.3, 7.5)*
- **REQ-FA9 — No real money auto-triggered; three explicit payment modes.** The automatic audit uses sandbox only (even on VPS); live integrations may be checked with non-transacting readiness probes; a real live-money transaction is a separate, manual, operator-gated validation NEVER part of the automatic E2E. The audit never prints, rotates, or leaks a secret. *(Req 2.2, 4.2)*
- **REQ-FA10 — Report-and-gate, never silently patch.** Every RED item is a finding with evidence + owner + environment, routed to its owner; readiness is ALL-GREEN-in-both-environments + valid store artifacts; the operator executes the irreversible ship actions. *(Req 8.1, 8.2, 8.3, 8.4)*

## Non-Goals

- Re-running the unit/property/PBT suites — that is `quality-assurance-pbt`; full-audit references its results and focuses on live integration/readiness.
- Inventorying or filling configuration, or rotating/handling secrets — that is `secrets-inventory`; full-audit only verifies configured credentials actually connect and carries forward exposure findings.
- Implementing or changing feature behavior — defects are routed to the owning feature/spec.
- Guaranteeing store approval — it verifies submission readiness, not the store's review decision.
- Executing the irreversible actions itself (VPS deploy, store submission, live-money validation) — it declares readiness and guides; the operator executes.
- Replacing ongoing production monitoring — it is a point-in-time readiness audit (though it verifies monitoring is wired).
- Moving real money in a test, or printing/leaking any secret.
- Being a one-off — the readiness checklist and runbook are maintained artifacts for re-audit before each release.

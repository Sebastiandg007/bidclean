# Deployment Readiness Runbook

The operator's guide for taking BidClean to go-live using the `full-audit`
(deployment-readiness) tooling. full-audit **declares** readiness; the operator
**executes** the irreversible actions, in this exact order:

```
reconcile registry → local audit GREEN → deploy to VPS → VPS audit GREEN → package mobile → submit
```

Green locally is not enough — green-on-VPS is the real bar. A component that works
locally but is unreachable/misconfigured on the VPS is a blocking finding.

---

## Step 0 — Reconcile the component registry (FIRST, always)

The registry (`tools/full-audit/registry/component-registry.yaml`) is authoritative
for "every component". That authority is only safe if the registry stays in sync
with its source of truth: the owning specs (1–24) and `docs/ARCHITECTURE.md`.

**Day-one this is a documented manual review** (mirroring `secrets-inventory`):

1. Walk the owning specs and the ARCHITECTURE topology; confirm every component
   (service, infra, Nest module, BullMQ worker, outbox/event consumer, scheduled
   job, webhook ingress, AI endpoint, mobile feature module) is declared in
   `tools/full-audit/registry/declared-components.ts`.
2. Run any audit (`--env local`). If the registry diverges from the declared set
   — a declared component missing from the registry, or a registry entry with no
   owning declaration — the CLI prints a blocking `REGISTRY_STALE` finding and
   exits non-zero **before** building the checklist.
3. Reconcile the YAML + `declared-components.ts` until there is no divergence.
   A stale registry cannot silently drift (this guards Property 1's completeness).

Only once reconciliation passes does the checklist get built.

---

## Step 1 — Local audit (Docker on the dev machine)

1. Bring up the full stack locally: `docker compose up -d` (API, AI, Postgres+PostGIS,
   Redis, MinIO, Keycloak, Centrifugo, LiveKit, LibreTranslate, Whisper, Piper,
   monitoring). Confirm migrations are applied and `secrets-inventory` is
   startup-valid.
2. Enable live probing and run the local audit:

   ```powershell
   $env:FULL_AUDIT_LIVE_STACK = "1"
   npx ts-node -T --project tools/full-audit/tsconfig.json tools/full-audit/audit.cli.ts --env local
   ```

3. Read `tools/full-audit/reports/readiness-report.local.json` and the refreshed
   `docs/deployment/READINESS-CHECKLIST.md`. Every mandatory + applicable item
   must be `PASS`.
4. For each `FAIL`, route the finding to its owner (the `owner` field):
   - a feature defect → the owning spec/module,
   - missing/invalid config → `secrets-inventory`,
   - a failing property → the owning spec + `quality-assurance-pbt`,
   - a store artifact → mobile build / `samsung-optimization`,
   - a DevOps item → infra.
   Fix at the owner, then re-audit. Never patch inside full-audit.
5. Local audit is GREEN when the verdict is `READY` for the local run.

> **Fase 1 note:** with the stack down (`FULL_AUDIT_LIVE_STACK` unset) every
> edge/integration/journey/store/devops probe returns an honest `FAIL`
> ("target unreachable — Fase 2"). That is expected: those FAILs are exactly the
> ones that turn green in Fase 2 once the stack is up.

---

## Step 2 — Deploy to the VPS (operator action)

Deploy the same stack behind Traefik with the real domains and SSL
(`api/ws/rtc/storage/auth.bidclean.tech`). Confirm production-appropriate
configuration is in effect (real URLs, live/sandbox integrations as intended, no
debug-only settings).

---

## Step 3 — VPS audit (the live target)

```powershell
$env:FULL_AUDIT_LIVE_STACK = "1"
# set the FULL_AUDIT_VPS_* target URLs if they differ from the defaults
npx ts-node -T --project tools/full-audit/tsconfig.json tools/full-audit/audit.cli.ts --env vps
```

The VPS audit uses the **same invariants** with environment-appropriate probes
(public subdomains + live certs). It additionally verifies the VPS specifics:
real domains resolve, Traefik terminates valid Let's Encrypt SSL, the subdomains
route, monitoring is receiving data, and a recent readable backup artifact exists.

- A mandatory+applicable item that was `PASS` locally but `FAIL` on the VPS is a
  blocking `PARITY_BREAK` — fix and re-audit.
- Items only meaningful in one environment (real certs, prod domains, VPS routing,
  production monitoring) are `N/A` in the other **with a justification** — never
  forced GREEN, never silently skipped.

VPS audit is GREEN when the two-environment verdict is `READY` (both environment
reports present, all mandatory+applicable items PASS, every `N/A` justified, no
parity break, store artifacts valid, no carried-forward `SECRET_EXPOSURE`).

---

## Step 4 — Package the mobile app

Build the single Expo codebase into the store artifacts: Android AAB (Play +
Galaxy), iOS build; confirm icon (1024×1024), screenshots (incl. unfolded/
large-screen), listing metadata, content rating, privacy link, and a reviewer
test path. The `store-readiness` probe validates presence + validity. Readiness
is **not** approval — the store's review is its own gate.

---

## Step 5 — Submit (operator action)

Submit to the stores guided by the GREEN checklist. Supply the reviewer test
account/credentials to the store **without committing them to the repo**.

---

## Live-money validation (OUTSIDE the automatic audit)

The automatic audit never fires a real financial operation. External-payment
edges are validated in three separated modes:

- **sandbox** — the automatic readiness E2E (no real money, even on VPS).
- **live-readiness** — automatic non-transacting reachability/auth probes.
- **operator-live-money** — a real transaction: **manual, operator-gated, and
  NEVER part of the automatic audit** (`assertAutomaticModeAllowed` throws on it).

To validate a real live-money path, the operator performs a single controlled
real transaction **by hand** on the VPS (a small charge + refund), outside the
`full-audit` CLI, and records the outcome. The audit itself must never select
`operator-live-money`.

---

## What belongs to Fase 2 (integration against the running stack)

These are operator steps, not part of the Fase-1 pure core:

- Component presence + health, inter-service edges (reachable + authenticated),
  and external integrations against the running stack (tasks 11.2).
- Durable event chains and live journeys end-to-end against real services
  (tasks 11.3).
- VPS specifics + DevOps/security/monitoring on the live target (tasks 11.4).
- Store artifact build/readiness checks (task 11.5).

Each of these runs 1–3 times per environment (behavior does not vary with input),
local then VPS, with `FULL_AUDIT_LIVE_STACK=1`.

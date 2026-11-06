# dispute-system (Spec 21)

## Purpose

Owns the dispute CASE and its resolution — never the money ledger. A Host (or, in defined cases, a Cleaner) raises a dispute over a completed service; evidence is gathered from the durable facts the service already produced; a resolution (`FAVOR_CLEANER` / `FAVOR_HOST` / `PARTIAL`) is reached; and that resolution durably drives the escrow's existing refund / reversal / release machinery in **Spec 9 (stripe-escrow)**. This module holds NO Stripe keys and imports NO Stripe SDK: it only chooses a resolution and durably enqueues the action Spec 9 executes.

The full flow: **Spec 20 routing → `service_disputed` in `completion_outbox` → this module's consumer creates the case → OPEN escrow-block intent → evidence gather → resolve/expire (single-winner) + financial intent → `FinancialIntentWorker` → Spec 9 refund/reversal/release → clear-escrow-LAST `setDisputeStatus(NONE)`**.

## Files

| File | Responsibility |
|------|----------------|
| `dispute.constants.ts` | All `DISPUTE_*` env-configurable values + queue/consumer/table names |
| `config/validate-dispute-config.ts` | Fail-fast `validateDisputeConfig()` (lease > drain interval; retention floor) |
| `dispute.types.ts` | Enums (state/phase/resolution/kind/intent status incl. `ACTION_BLOCKED`, `EscrowActionResult`), views, `EscrowActionOutcome`, error strings |
| `dispute.controller.ts` | JWT-guarded REST surface (GET, evidence request-upload/finalize/add, evidence-url, resolve). **No `POST /disputes`** |
| `dispute-outbox.ts` | `dispute_opened` / `dispute_resolved` outbox row builders |
| `policy/dispute-initiation.policy.ts` | Pure `(role, reason_code, phase)` → allow/deny from config |
| `policy/resolution-mapping.ts` | Pure resolution → financial action mapping |
| `escrow/escrow.client.ts` | The ONLY bridge to Spec 9 (thin, injectable, mockable); no Stripe |
| `evidence/upstream-evidence.reader.ts` | Read-only structured resolution of checklist/verification/arrival refs |
| `storage/dispute-evidence-storage.service.ts` | MinIO presign PUT/GET, authoritative inspect, idempotent delete |
| `repository/dispute.repository.ts` | Single-winner writes + outbox + intents (one tx); idempotent active creation |
| `repository/dispute-escrow-intent.repository.ts` | OPEN/NONE intent drain / lease claim / accept / fail |
| `repository/dispute-financial-intent.repository.ts` | PENDING intent drain / claim / accept / `ACTION_BLOCKED` / fail |
| `repository/dispute-evidence.repository.ts` | Evidence references + host photos; terminal-only retention scan |
| `repository/dispute-upload-grant.repository.ts` | Single-use grant persisted before the pre-signed PUT |
| `repository/dispute-object-deletion.repository.ts` | Tombstone drain of freed `HOST_PHOTO` keys |
| `repository/completion-outbox-consumer.checkpoint.ts` | Per-consumer ack over Spec 20's `completion_outbox` (`consumer_name='dispute'`) |
| `service/dispute-creation.service.ts` | Idempotent `createFromRouting`; phase from Spec 9 `payout_status` |
| `service/dispute-lifecycle.service.ts` | Resolver-gated single-winner transitions |
| `service/dispute-resolution.service.ts` | Resolution → durable financial intent (no Stripe, no clear here) |
| `service/dispute-sla.service.ts` | SLA `expireDue` with the mandatory fallback resolution |
| `service/dispute-evidence.service.ts` | Grant / finalize / structured / gated resolve |
| `service/dispute-participation.service.ts` | `isParticipant` / `isResolver` / `canView` |
| `service/dispute-view.service.ts` | The `GET` reconciliation view (no internal intent fields) |
| `consumers/dispute-created.consumer.ts` | Drains `service_disputed` via the `'dispute'` checkpoint |
| `jobs/escrow-intent.worker.ts` | Drains OPEN/NONE intents → `setDisputeStatus` (keys off `payment_id`) |
| `jobs/financial-intent.worker.ts` | Drains PENDING intents → refund/release; clear-escrow-LAST; `BLOCKED → ACTION_BLOCKED` |
| `jobs/dispute-sla-sweep.processor.ts` | Bounded sweep of due non-terminal disputes → EXPIRED |
| `jobs/evidence-retention.processor.ts` | Hard-deletes TERMINAL-dispute objects past the horizon only |
| `jobs/tombstone-drain.processor.ts` | Drains pending object-key tombstones |
| `jobs/stale-grant-cleanup.processor.ts` | Cleans orphan uploads + stale `ISSUED` grants |

## Dependencies

- **Spec 20 service-completion** — read-only over `completion_outbox` via a `consumer_name='dispute'` checkpoint (the trigger). Also creates `completion_outbox_consumers`.
- **Spec 9 stripe-escrow** (`PaymentsModule`) — the ONLY money authority, reached via `EscrowClient`: `DisputeService.setPlatformDisputeStatus`, `DisputeSettlementService.releaseForDispute`/`refundForDispute`, `PaymentsRepository.findDisputeSettlement`.
- **Spec 17/18/19** (service-tracking / video-verification / checklist-photos) — read-only structured references for evidence.
- MinIO (`MINIO_*`), Redis/BullMQ, PostgreSQL.

## API

| Method | Path | Actor | Description |
|--------|------|-------|-------------|
| `GET` | `/disputes/:id` | Participant/resolver | Authoritative state + phase + resolution + evidence refs + deadlines |
| `POST` | `/disputes/:id/evidence/request-upload` | Participant | Grant-gated pre-signed PUT target |
| `POST` | `/disputes/:id/evidence/finalize` | Participant | Finalize a photo (grant + window + server-inspect) |
| `POST` | `/disputes/:id/evidence` | Participant | Add structured `HOST_REASON`/`NOTE` |
| `GET` | `/disputes/:id/evidence/:evidenceId/url` | Participant/resolver | Visual → pre-signed GET; structured → gated data |
| `POST` | `/disputes/:id/resolve` | Resolver | Single-winner `→ RESOLVED` + financial intent |

`setDisputeStatus`/refund/release are NOT REST actions — they are driven only by the intent workers.

## Environment variables

See `WIRING.md` for the full list of `DISPUTE_*` keys (windows, SLA, fallback, reason codes, initiation policy, evidence bucket/limits/TTLs, retention floor, sweep/drain/lease/cleanup tuning) and `DISPUTE_RESOLVER_ROLE`. **No Stripe keys are added by this spec.** `MINIO_*` is reused (server-only, shipped only as time-boxed pre-signed URLs).

## Guarantees

- **clear-escrow-LAST** — `disputeStatus` stays `OPEN` until Spec 9 durably APPLIES the financial action (`APPLIED`/`CEILING_CLAMPED`/`NO_OP`); a `BLOCKED` outcome → `ACTION_BLOCKED` needs-review terminal, escrow stays `OPEN`.
- **Two durable intents (crash-safe, lease reclaim)** — `dispute_escrow_intents` (OPEN then NONE) + `dispute_financial_intents` (release/refund). Both `dispute_id ON DELETE SET NULL` + `payment_id NOT NULL` so they survive the case; workers key off `payment_id`.
- **Single-winner terminality** — resolve vs SLA-expiry → exactly one of RESOLVED/EXPIRED, exactly one financial intent (`uq_dispute_financial_intent_dispute`).
- **P15 authority in Spec 9** — at most one dispute-driven financial effect per payment across all its disputes (`dispute_settled_at` guard → `PAYMENT_ALREADY_SETTLED`).

## How to run (tests)

```
cd services/api
NODE_ENV=test npx jest src/dispute-system --runInBand
```

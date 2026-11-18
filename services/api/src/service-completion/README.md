# service-completion (Spec 20)

## Purpose

Closes the service loop (the last of Sprint 5 — Service Execution). After the Cleaner finalizes the
checklist (Spec 19's durable `checklist_completed`, carrying the authoritative finish time), the
Host **confirms satisfaction** (releasing the escrowed payment), does nothing (an **auto-release**
fires after a configured window), or **opens a dispute** (routed to Spec 21, which pauses
auto-release). A mutual **rating** is captured at the end but never gates release.

This module owns the completion **DECISION** and durably enqueues the release **intent**; it never
moves money. The escrow (Spec 9) remains the source of truth for money — `service-completion` maps a
decision to a `ReleaseReason` and, in the SAME transaction as the decision, persists a durable
`release_intent`; a worker drains it into `EscrowReleaseService.release(...)` with idempotent
retries and lease-based crash recovery. It holds no Stripe keys, makes no Stripe calls, and
recomputes no commission. See `ADR-018`.

## Files

| File | Responsibility |
|------|---------------|
| `completion.constants.ts` | Env-configurable values, queue/consumer names, and `validateServiceCompletionConfig()` (fail-fast). |
| `config/validate-service-completion-config.ts` | Re-export entry point for the fail-fast validator. |
| `completion.types.ts` | Enums (state / release reason / intent status / rating role / release status), the `checklist_completed` payload, view types, error strings. |
| `completion-outbox.ts` | Deterministic `service_confirmed` / `service_disputed` / `service_rated` outbox row builders. |
| `entities/service-completion.entity.ts` | The durable completion DECISION (`service_completions`). |
| `entities/release-intent.entity.ts` | The durable financial command (`release_intents`). |
| `entities/service-rating.entity.ts` | The mutual rating (`service_ratings`). |
| `entities/completion-outbox.entity.ts` | The fan-out outbox (`completion_outbox`). |
| `repository/completion.repository.ts` | Single-winner transition (co-writing intent + outbox), post-release-dispute ACCEPTED gate, creation, reads, cross-module resolution. |
| `repository/release-intent.repository.ts` | Drain / single-winner lease claim / accept / fail-retryable. |
| `repository/service-rating.repository.ts` | One-per-side rating insert + co-written `service_rated`. |
| `repository/checklist-outbox-consumer.checkpoint.ts` | Per-consumer draining primitive over Spec 19's `checklist_outbox` (`consumer_name='completion'`). |
| `service/completion-participation.service.ts` | `isHost` / `isCleaner` / `isParticipant` (the authorization rule). |
| `service/completion-creation.service.ts` | Idempotent `createFromChecklistCompleted` (snapshots the deadline from `completedAt`). |
| `service/completion-decision.service.ts` | Host-only `confirm` / `openDispute` / `openPostReleaseDispute` (single-winner). |
| `service/auto-release.service.ts` | Single-winner `autoReleaseDue` (sweep transition). |
| `service/rating.service.ts` | Captured rating (never gating) + participant-gated read. |
| `service/completion-view.service.ts` | `GET` reconciliation view + derived `release_status`. |
| `consumers/completion-created.consumer.ts` | Drains `checklist_completed` (own checkpoint), creates the completion. |
| `jobs/auto-release-sweep.processor.ts` | Bounded repeatable auto-release sweep. |
| `jobs/release-intent.worker.ts` | Bounded repeatable drain → `EscrowReleaseService.release` (the ONLY path calling Spec 9). |
| `dto/submit-rating.dto.ts` | Rating submission body. |
| `completion.controller.ts` | REST surface (`/service-completions`). |
| `service-completion.module.ts` | Module wiring + fail-fast config validation on boot. |

## Dependencies

- **Spec 9 (payments):** imports `PaymentsModule` for `EscrowReleaseService` (the release seam).
- **Spec 19 (checklist-photos):** consumes `checklist_completed` from `checklist_outbox` via its own
  `checklist_outbox_consumers` checkpoint (`consumer_name='completion'`). Relies on the additive
  `completedAt` field on `checklist_completed`.
- **Spec 21 (dispute-system, downstream):** receives `service_disputed` via its own checkpoint.
- **Spec 16 / Spec 22 (downstream):** consume `service_confirmed` / `service_rated`.
- Shared Redis/BullMQ + `@nestjs/schedule`; PostgreSQL via TypeORM.

## API

| Method | Path | Actor | Description |
|--------|------|-------|-------------|
| GET | `/service-completions/:id` | Host or Cleaner | State + snapshotted deadline + rating status + derived `release_status` (`NOT_TRIGGERED`/`PENDING`/`ACCEPTED`). |
| POST | `/service-completions/:id/confirm` | Host only | Single-winner → `CONFIRMED` + `release_intent(HOST_CONFIRMED)` + `service_confirmed`. |
| POST | `/service-completions/:id/dispute` | Host only | Single-winner → `DISPUTED` + `service_disputed`; suppresses auto-release. |
| POST | `/service-completions/:id/post-release-dispute` | Host only | Sets `post_release_dispute_id` + `service_disputed`; only when `release_status = ACCEPTED` (else `409`). |
| POST | `/service-completions/:id/ratings` | Host or Cleaner | One rating per side (1..5 + optional comment) + `service_rated`; never gating. |
| GET | `/service-completions/:id/ratings` | Host or Cleaner | Participant-gated ratings read. |

A non-participant receives `403` and learns nothing. `release` is not a REST action — it is driven
only by the `ReleaseIntentWorker`.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SERVICE_AUTO_RELEASE_WINDOW_MS` | Auto-release window (default `86400000` = 24h); snapshotted per completion. | Yes |
| `SERVICE_COMPLETION_SWEEP_INTERVAL_MS` | Auto-release sweep interval. | Yes |
| `SERVICE_COMPLETION_SWEEP_BATCH_SIZE` | Max completions per sweep pass. | Yes |
| `SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS` | Release-intent drain interval. | Yes |
| `SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE` | Max intents per drain pass. | Yes |
| `SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS` | Claim lease held on a DISPATCHED intent; MUST be `> SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS`. | Yes |
| `SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS` | `checklist_completed` drain interval. | Yes |
| `SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE` | Max events per creation drain pass. | Yes |
| `SERVICE_RATING_MIN_STARS` | Rating floor (default `1`). | Yes |
| `SERVICE_RATING_MAX_STARS` | Rating ceiling (default `5`). | Yes |

No Stripe keys are added by this spec — money authority stays in Spec 9.

## How to Run

Registered via `ServiceCompletionModule` in the app module. Under `NODE_ENV=test` the config
validator and the scheduled jobs are skipped (tests drive `drainOnce`/`sweepOnce` directly). See
`WIRING.md` for the exact app-module registration, `.env` keys, and documentation edits the
orchestrator applies.

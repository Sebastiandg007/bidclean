# checklist-photos (Spec 19)

## Purpose

Records **the work itself** while a service is `IN_PROGRESS` (Spec 17): the Cleaner works through the
property's snapshotted cleaning checklist, marking tasks done and attaching before/after photo
evidence. Finalizing emits a durable `checklist_completed` fact that `service-completion` (Spec 20)
settles escrow on and `dispute-system` (Spec 21) uses as evidence. This module never releases escrow,
resolves disputes, or rates — it records and emits the facts they consume.

The run is created by consuming the durable `service_started` outbox event (own
`consumer_name='checklist'` checkpoint over Spec 17's `service_outbox` fan-out) — never a synchronous
call, never polling. The checklist **and** the policies are snapshotted as-of the IN_PROGRESS moment
(carried on the event), so a later property edit or config change never re-validates an in-flight run.

Photo bytes live only in a private MinIO bucket (grant-gated pre-signed URLs, key ≠ credential) and
never transit the API hot path or PostgreSQL. Playback is participant-gated and session-scoped (the
Host may view evidence; a cross-session photo id is never served).

## Files

| File | Responsibility |
|------|---------------|
| `checklist.constants.ts` | All `CHECKLIST_*` config + `validateChecklistPhotosConfig()` (fail-fast) |
| `checklist.types.ts` | Domain types, enums, `StartedPayload`, error strings |
| `config/validate-checklist-photos-config.ts` | Re-export of the fail-fast validator |
| `checklist.controller.ts` | REST surface nested under `service-sessions/:id/checklist` |
| `checklist-photos.module.ts` | Module wiring (entities, queue, providers, validator) |
| `storage/checklist-storage.service.ts` | MinIO presign PUT/GET, authoritative object inspection, idempotent delete |
| `repository/checklist.repository.ts` | Runs/tasks/photos/outbox + the `lockRun` serialization point + single-winner `transitionRun` + session-scoped photo lookup |
| `repository/checklist-upload-grant.repository.ts` | Single-use grants (create-before-URL, cap counting, consume, stale-close) |
| `repository/checklist-object-deletion.repository.ts` | Tombstone drain |
| `service/checklist-run-creation.service.ts` | `createFromStarted` (idempotent, event-carried snapshot) |
| `service/checklist-participation.service.ts` | `isParticipant` / `isCleaner` / `isInProgress` |
| `service/checklist-task.service.ts` | Cleaner-only, IN_PROGRESS-gated task marking with the count invariant |
| `service/checklist-photo.service.ts` | `requestUpload` (atomic slot reservation) / `finalizeUpload` (run-locked) / `getPlaybackUrl` (session-scoped) |
| `service/checklist-run.service.ts` | `finalize` (+ outbox), `forceAbandon*`, `getChecklist` |
| `consumers/checklist-started.consumer.ts` | Drains `service_started` (`consumer_name='checklist'`) |
| `consumers/started-payload.mapper.ts` | Untrusted JSONB → typed `StartedPayload` |
| `listeners/offer-terminal-checklist.listener.ts` | Force-ABANDONED on offer terminal (`@OnEvent`) |
| `jobs/retention-cleanup.processor.ts` | Hard-delete photos past retention |
| `jobs/tombstone-drain.processor.ts` | Drain freed object-key tombstones |
| `jobs/stale-upload-grant-cleanup.processor.ts` | Delete orphan objects + close stale grants |
| `jobs/stuck-run-sweep.processor.ts` | ABANDONED backstop for a missed terminal signal |

## Dependencies

- **service-tracking (Spec 17):** consumes the `service_started` event via the reused
  `ServiceOutboxConsumerCheckpoint` (`consumer_name='checklist'`); reacts to the offer terminal event.
- **property-management (Spec 5):** the checklist template (`checklistItems`) is snapshotted onto the
  event at IN_PROGRESS (read-only; never written here).
- **MinIO** (private `checklist-photos` bucket), **Redis/BullMQ** (sweep queue), **PostgreSQL**.
- Downstream: **service-completion (Spec 20)** and **dispute-system (Spec 21)** consume
  `checklist_completed` from `checklist_outbox` via their own checkpoints.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/service-sessions/:id/checklist` | Participant-gated reconciliation (run + tasks + photo refs) |
| POST | `/service-sessions/:id/checklist/tasks/:taskId` | Cleaner marks a task `{ done }` (ACTIVE + IN_PROGRESS) |
| POST | `/service-sessions/:id/checklist/tasks/:taskId/photo/request-upload` | Reserve a slot + grant → `{ objectKey, uploadUrl, expiresAt }` |
| POST | `/service-sessions/:id/checklist/tasks/:taskId/photo/finalize` | Finalize an uploaded photo (server re-inspects) |
| GET | `/service-sessions/:id/checklist/photos/:photoId/playback-url` | Session-scoped participant-gated pre-signed GET |
| POST | `/service-sessions/:id/checklist/finalize` | Precondition-gated → `COMPLETED` + `checklist_completed` |

## Environment Variables

See `WIRING.md` for the full list (all `CHECKLIST_*` + reused `MINIO_*`). `validateChecklistPhotosConfig()`
runs at startup (skipped under `NODE_ENV=test`).

## How to Run

Part of the API service. Tests: `npx jest src/checklist-photos --runInBand`.

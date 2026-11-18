# Implementation Plan: Checklist Photos

## Overview

`checklist-photos` (Spec 19, Sprint 5 — Service Execution) records **the work itself**: while a service is `IN_PROGRESS` (Spec 17), the Cleaner works through the property's snapshotted cleaning checklist, marking each task done and attaching before/after photo evidence, so the finished job carries a truthful, structured completion record that `service-completion` (Spec 20) settles escrow on and `dispute-system` (Spec 21) uses as evidence. It is **not a new domain** — it composes patterns already proven in the sibling specs and narrows each to the checklist case.

This plan is bottom-up and builds incrementally: config/constants + migration (the six tables — `checklist_runs`, `checklist_tasks`, `checklist_task_photos`, `checklist_upload_grants`, `checklist_photo_object_deletions`, `checklist_outbox` — plus the `BEFORE DELETE` tombstone trigger) → entities/types → storage service (MinIO presign/inspect/delete, mirrors `VoiceNoteStorageService`/`PropertyPhotoService`) → grant + object-deletion + checklist repositories (with the run `FOR UPDATE` lock as the single serialization point) → services (idempotent creation off `service_started`, Cleaner-only run-locked task marking with the count invariant, the grant/finalize/playback photo flow with atomic per-task slot reservation, run finalize/abandon with single-winner terminality + `checklist_outbox`) → the started consumer + offer-terminal listener → cleanup/sweep jobs (retention, tombstone drain, stale-upload-grant cleanup, stuck-run sweep) → controller + module wiring → mobile (store, api, photo capture, Cleaner/Host screens, i18n) → property-based, unit, DDL, integration, and mobile tests → docs. Everything is testable in CI (backend) and locally (mobile) with MinIO, BullMQ, Centrifugo, and the WebSocket mocked — zero real external calls.

Scope: one checklist run per in-progress session, snapshotted at IN_PROGRESS (checklist **and** policies carried on the durable `service_started` event); photo bytes in MinIO (never PostgreSQL, never the API hot path); Cleaner mutates, Host observes + views evidence; completion is a durable fact, not settlement; retention bounded by a dispute window. See `requirements.md` (7 requirements + REQ-CP1…REQ-CP14) and `design.md` (Properties P1–P15).

## Tasks

- [ ] 1. Backend config, constants & schema
  - [ ] 1.1 Add checklist-photos env keys to `.env.example`
    - Add `CHECKLIST_PHOTO_MINIO_BUCKET`, `CHECKLIST_PHOTO_MAX_SIZE_BYTES`, `CHECKLIST_PHOTO_ALLOWED_MIME_TYPES`, `CHECKLIST_PHOTO_MAX_PER_TASK`, `CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS`, `CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS`, `CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS`, `CHECKLIST_PHOTO_RETENTION_DAYS`, `CHECKLIST_PHOTO_REQUIRED_POLICY`, `CHECKLIST_COMPLETION_PRECONDITION`, `CHECKLIST_SWEEP_INTERVAL_MS`, `CHECKLIST_SWEEP_BATCH_SIZE`, `CHECKLIST_CLEANUP_INTERVAL_MS`, `CHECKLIST_CLEANUP_BATCH_SIZE`, `CHECKLIST_STALE_GRANT_INTERVAL_MS`, `CHECKLIST_STALE_GRANT_BATCH_SIZE`; document that `MINIO_*` (endpoint/credentials, already present) are reused; add mobile `EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES` (UX pre-check only)
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 1.2 Create checklist-photos constants with fail-fast validation
    - Create `services/api/src/checklist-photos/checklist.constants.ts` and `config/validate-checklist-photos-config.ts`: parse all `CHECKLIST_*` values + the reused `MINIO_*`; `validateChecklistPhotosConfig()` fail-fast at startup (skipped under `NODE_ENV=test`): non-empty bucket, positive TTLs/limits/retention/max-per-task, non-empty MIME list, parseable photo-required + completion-precondition policies; no hardcoded values in logic
    - _Requirements: 6.1, 6.2 · P15_
  - [ ] 1.3 Create the checklist-photos schema migration + tombstone trigger
    - Create `services/api/src/migrations/<timestamp>-CreateChecklistPhotoTables.ts` (reversible `up()`/`down()`, `IF NOT EXISTS`, table/column comments): (a) `checklist_runs` (`UNIQUE service_session_id` FK CASCADE; `offer_id` FK CASCADE indexed; `property_id` FK SET NULL indexed; `total_tasks`, `completed_tasks DEFAULT 0`, `photo_required_policy_snapshot`/`completion_precondition_snapshot` JSONB, `max_photos_per_task_snapshot` INT; `state VARCHAR(20) DEFAULT 'ACTIVE'`, `completed_at`, `abandoned_reason`; NO `deleted_at`; `CHECK` state, `CHECK (completed_tasks >= 0 AND completed_tasks <= total_tasks)`; `idx_checklist_runs_active (state, updated_at) WHERE state='ACTIVE'`); (b) `checklist_tasks` (`run_id` FK CASCADE indexed; `position`, `UNIQUE (run_id, position)`; `task_text` TEXT, `is_done` BOOLEAN DEFAULT false, `completed_at`; `idx_checklist_tasks_run_done`); (c) `checklist_task_photos` (`task_id`/`run_id` FK CASCADE indexed; `object_key UNIQUE`, `kind VARCHAR(20) DEFAULT 'GENERAL'` CHECK, `size_bytes`, `mime_type`, `width?`, `height?`, `object_deleted_at?`, `uploaded_at DEFAULT NOW()`; NO `deleted_at`; `idx_checklist_task_photos_retention (uploaded_at) WHERE object_deleted_at IS NULL`); (d) `checklist_upload_grants` (`object_key` PK; `run_id`/`task_id` FK CASCADE indexed; `issued_to_user_id` FK SET NULL nullable; `status VARCHAR(20) DEFAULT 'ISSUED'` CHECK `ISSUED/CONSUMED/EXPIRED/CANCELLED`; `expires_at`, `consumed_photo_id` FK SET NULL; `idx_checklist_grants_status_expires`); (e) `checklist_photo_object_deletions` tombstone (`object_key` PK, `reason VARCHAR(30) DEFAULT 'CASCADE'`, `status VARCHAR(20) DEFAULT 'PENDING'`, `created_at`, `processed_at?`; `idx_checklist_object_deletions_status_created`) + `checklist_photo_tombstone_object()` function + `BEFORE DELETE` trigger on `checklist_task_photos` (`ON CONFLICT (object_key) DO NOTHING`, only when a live key exists); (f) `checklist_outbox` (`event_id UNIQUE`, `aggregate_type DEFAULT 'checklist_run'`, `aggregate_id`, `type`, `payload` JSONB, `version DEFAULT 1`, `created_at`; NO `relayed_at`; `idx_checklist_outbox_created`); `down()` drops in dependency order
    - _Requirements: 7.1, 7.2, 7.3 · P1, P8, P13, P14, P15_

- [ ] 2. Entities & types
  - [ ] 2.1 Create checklist entities
    - Create `services/api/src/checklist-photos/entities/checklist-run.entity.ts`, `checklist-task.entity.ts`, `checklist-task-photo.entity.ts` (and the grant/object-deletion/outbox entities as needed) mirroring sibling conventions (timestamptz, snake_case, `@Unique`/`@Index` matching the migration, `CHECK`-backed `state`/`kind`/grant `status` unions, no `deleted_at` on metadata)
    - _Requirements: 7.1_
  - [ ] 2.2 Create checklist domain types + error strings
    - Create `services/api/src/checklist-photos/checklist.types.ts` (`ChecklistRun`, `ChecklistTask`, `TaskPhotoRef`, `UploadTarget`, `PlaybackTarget`, `InspectResult`, `StartedPayload` incl. event-carried checklist snapshot + `photo_required_policy`/`completion_precondition`/`max_photos_per_task`, run/photo `kind`/`status`/`state` enums) and error strings (object keys / photo bytes never embedded verbatim)
    - _Requirements: 1.2, 3.6, 6.4_

- [ ] 3. Storage service (MinIO)
  - [ ] 3.1 Implement ChecklistStorageService
    - Create `services/api/src/checklist-photos/storage/checklist-storage.service.ts` (mirrors `VoiceNoteStorageService`/`PropertyPhotoService`, `minio` client, private bucket from config, ensure-bucket on init): `issueUploadTarget()` → `{ objectKey (crypto.randomUUID path), uploadUrl (presignedPutObject, upload TTL) }`; `getPlaybackUrl(objectKey)` (presignedGetObject, playback TTL); `inspectObject(objectKey)` → `{ exists, sizeBytes, contentType, width?, height? }` where size/content-type come from `statObject` and dimensions are probed from the image (bounded read) — the AUTHORITATIVE values; `deleteObjectSafe(objectKey)` idempotent
    - _Requirements: 3.1, 3.2, 3.3, 7.5 · P4, P9, P15_
  - [ ]* 3.2 Unit tests for ChecklistStorageService
    - upload target generates an unguessable key + scoped PUT URL; playback URL minted with TTL; `inspectObject` returns server-observed size/content-type/dimensions and flags unprobeable/oversized/wrong-type; `deleteObjectSafe` idempotent (already-deleted handled); `minio` fully mocked
    - _Requirements: 3.2, 3.3, 7.5 · P4, P9, P15_

- [ ] 4. Repositories
  - [ ] 4.1 Implement ChecklistUploadGrantRepository
    - Create `services/api/src/checklist-photos/repository/checklist-upload-grant.repository.ts`: `createGrant({ objectKey, runId, taskId, issuedToUserId, expiresAt })` (status `ISSUED`, persisted before the URL under the run lock); `countActiveGrantsForTask(taskId, now, manager)` (ISSUED + unexpired only, for the atomic slot reservation); `findConsumable(objectKey, manager)` (exists, ISSUED, unexpired, matching run/task); `markConsumed(objectKey, photoId, manager)`; `findStaleGrants(now, limit)`; `markClosed(objectKey, status, manager)` (ISSUED → `EXPIRED`/`CANCELLED`); parameterized SQL only
    - _Requirements: 3.1, 3.4, 7.4 · P7, P8, P15_
  - [ ] 4.2 Implement ChecklistObjectDeletionRepository
    - Create `services/api/src/checklist-photos/repository/checklist-object-deletion.repository.ts`: `drainPending(limit)` (oldest-first, batched) and `markDone(objectKey)` (`processed_at = NOW()`) for the tombstone drain; parameterized SQL only
    - _Requirements: 7.2, 7.5 · P14_
  - [ ] 4.3 Implement ChecklistRepository (runs/tasks/photos/outbox + the run lock)
    - Create `services/api/src/checklist-photos/repository/checklist.repository.ts`: `createRun(params)` + `bulkInsertTasks(runId, items, manager)` idempotent `ON CONFLICT (service_session_id) DO NOTHING`; `lockRun(runId, manager)` (`SELECT ... FOR UPDATE` — the single serialization point shared by request-upload/finalize-photo/finalize-checklist); `markTaskAtomic(runId, taskId, done, manager)` (sets task fields + recomputes `completed_tasks = COUNT(is_done=true)` under the lock); `transitionRun(id, expected, next, derivedFields, outboxEvents, manager)` (single-winner `UPDATE ... WHERE id=:id AND state=:expected` + `checklist_outbox` row in ONE tx); `insertPhoto`, `findRunBySessionId`, `findPhotoScopedToSession(photoId, sessionId, manager)` (`photo→task→run WHERE run.service_session_id=:id`), `findTasks`, `findPhotosForTask`, `countPhotosForTask`, `findRetentionEligible(before, limit)`, `findStaleActiveRuns(before, limit)`; parameterized SQL only
    - _Requirements: 2.1, 3.3, 3.5, 4.1, 7.4 · P5, P9, P10, P13_
  - [ ]* 4.4 Unit tests for repositories
    - grant create-before-URL; `countActiveGrantsForTask` counts only ISSUED+unexpired; `findConsumable` rejects expired/consumed/foreign/mismatched run-task; `markConsumed` in-tx; `markClosed` ISSUED→EXPIRED/CANCELLED; `markTaskAtomic` recomputes the count under the lock; `transitionRun` single-winner + outbox atomic; idempotent `ON CONFLICT` create; `findPhotoScopedToSession` rejects a cross-session photo id; retention/stale scans select only eligible rows
    - _Requirements: 2.1, 3.4, 4.1, 7.4 · P5, P7, P10, P13, P14_

- [ ] 5. Participation & run-creation services
  - [ ] 5.1 Implement ChecklistParticipationService
    - Create `services/api/src/checklist-photos/service/checklist-participation.service.ts`: `isParticipant(userId, sessionId)` / `isCleaner(userId, sessionId)` resolving the session's `host_id`/`cleaner_id`; single source of the participation rule for every endpoint; a nulled participant resolves to non-participant while the row is retained
    - _Requirements: 1.5, 2.3, 3.4 · P3_
  - [ ] 5.2 Implement ChecklistRunCreationService
    - Create `services/api/src/checklist-photos/service/checklist-run-creation.service.ts`: `createFromStarted(payload)` copies the **event-carried** policy snapshots (`photo_required_policy`, `completion_precondition`, `max_photos_per_task`) onto the run — never reads live config — then in ONE tx `INSERT ... ON CONFLICT (service_session_id) DO NOTHING` the run (`total_tasks` = snapshot length, `completed_tasks = 0`, `state = ACTIVE`) and bulk-inserts the ordered tasks from the event-carried snapshot (`task_text`/`position` preserved). Empty snapshot ⇒ zero-task ACTIVE run; never throws into the consumer batch (per-row try/catch); never re-reads the live property
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6 · P1, P2_
  - [ ]* 5.3 Unit tests for creation & participation
    - run + ordered tasks from the event snapshot; policies snapshotted from the event (not live config); empty snapshot → zero-task run; idempotent `ON CONFLICT`; never reads the live property; host/cleaner resolution + role checks; nulled-participant → non-participant, row retained
    - _Requirements: 1.1, 1.2, 1.3, 1.5 · P1, P2, P3_

- [ ] 6. Task marking (Cleaner-only, IN_PROGRESS-gated, count invariant)
  - [ ] 6.1 Implement ChecklistTaskService
    - Create `services/api/src/checklist-photos/service/checklist-task.service.ts`: `markTask(sessionId, userId, taskId, done)` asserts the caller is the Cleaner AND the run is `ACTIVE` + session in the allowed IN_PROGRESS/completion-pending window (else `409`; Host is read-only → `403`); one transaction under `lockRun` (`SELECT ... FOR UPDATE`) that sets `is_done`/`completed_at` and recomputes `completed_tasks` so no concurrent mutation of another task in the run loses an update; idempotent per final state; functions ≤30 lines, SRP
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.4 · P5, P6_
  - [ ]* 6.2 Unit tests for ChecklistTaskService
    - Cleaner + IN_PROGRESS/window gates (Host → 403, non-window → 409, nothing changes); atomic mark under the run lock; `completed_tasks == COUNT(is_done=true)` after every commit; idempotent per final state
    - _Requirements: 2.1, 2.2, 2.3, 2.4 · P5, P6_

- [ ] 7. Photo evidence (grant / finalize / playback, run-locked)
  - [ ] 7.1 Implement ChecklistPhotoService.requestUpload (atomic per-task slot reservation)
    - Add `requestUpload(sessionId, userId, taskId)` to `services/api/src/checklist-photos/service/checklist-photo.service.ts`: assert Cleaner + run `ACTIVE` + IN_PROGRESS window; in ONE tx take `lockRun` (`SELECT ... FOR UPDATE`) and reserve a slot atomically — proceed only if `committed_photos + active_(ISSUED, unexpired)_grants < max_photos_per_task_snapshot` (else `409`); generate an opaque `object_key`; **persist the grant FIRST** (reserving the slot); mint a short-lived pre-signed PUT; return `{ objectKey, uploadUrl, expiresAt }`. Bytes never transit the API
    - _Requirements: 3.1, 3.2, 3.6 · P4, P7, P8_
  - [ ] 7.2 Implement ChecklistPhotoService.finalizeUpload (run-locked, server-authoritative, re-checked)
    - Add `finalizeUpload(sessionId, userId, taskId, dto)`: transaction that **first takes `lockRun`** (the same lock finalize-checklist takes, so the two serialize): re-verify the grant (exists, `issuedTo`=caller, matching run/task, unexpired, `ISSUED`) AND run still `ACTIVE` + session in the allowed window (re-checked at finalize, not only at request-upload) AND re-validate the cap (`committed_photos < max_photos_per_task_snapshot`) under the lock; server-inspect the object (exists, real size ≤ max, content-type an allowed image, dimensions probeable — authoritative, client metadata advisory); insert `checklist_task_photos` (`kind` ∈ BEFORE/AFTER/GENERAL); mark grant `CONSUMED`. `409` if run terminal by finalize time (no photo after `COMPLETED`); `400` on bad/over-limit/unprobeable object or cap exceeded (grant left unconsumed → cleanup-eligible orphan); `403`/`409` on bad grant
    - _Requirements: 3.3, 3.4, 3.6 · P8, P9, P13_
  - [ ] 7.3 Implement ChecklistPhotoService.getPlaybackUrl (session-scoped, participant-gated)
    - Add `getPlaybackUrl(sessionId, userId, photoId)`: resolve the photo via `findPhotoScopedToSession` (`photo→task→run WHERE run.service_session_id=:sessionId`) — a `photoId` not belonging to `:sessionId` → `404`, no disclosure; THEN participant-gate on `:sessionId`; resolve `object_key` from the resolved row (never a client-supplied key); mint a fresh short-lived pre-signed GET (Host MAY view evidence)
    - _Requirements: 3.4, 3.5 · P3, P10_
  - [ ]* 7.4 Unit tests for ChecklistPhotoService
    - grant-persisted-before-URL ordering; atomic per-task cap reservation under the run lock (concurrent requests can't both pass); finalize takes the run lock then re-checks authz + lifecycle + cap + server-authoritative inspection; late finalize after terminal → 409; bad/over-cap object → 400, grant unconsumed; playback resolves the key from DB via the session-scoped lookup (cross-session photoId → 404); non-participant denied; MinIO mocked
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6 · P3, P4, P7, P8, P9, P10_

- [ ] 8. Run finalize / abandon (single-winner terminality + outbox)
  - [ ] 8.1 Implement ChecklistRunService
    - Create `services/api/src/checklist-photos/service/checklist-run.service.ts`: `finalize(sessionId, userId)` asserts Cleaner, in ONE tx takes `lockRun` (the same lock finalize-photo uses), evaluates the run's **snapshotted** `completion_precondition` + `photo_required_policy` against the durable rows (never live config), computes the summary (`completedTasks`, `photoCount`) under the lock, then single-winner `ACTIVE → COMPLETED` + `checklist_completed { runId, serviceSessionId, totalTasks, completedTasks, photoCount }` into `checklist_outbox` in the SAME tx (unmet precondition → clear rejection, stays `ACTIVE`); `forceAbandonForSession(serviceSessionId, reason)` idempotent single-winner `ACTIVE → ABANDONED`; `getChecklist(sessionId, userId)` participant-gated reconciliation read (run + tasks + photo refs, never keys/bytes). Never releases escrow, resolves disputes, or rates
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 2.5, 7.4 · P11, P12, P13_
  - [ ]* 8.2 Unit tests for ChecklistRunService
    - finalize takes the run lock, evaluates the snapshotted precondition, computes the summary under the lock, single-winner finalize + outbox in one tx; unmet precondition → clear reject, stays ACTIVE; a photo finalize racing under the same lock is counted or rejected (never omitted from `photoCount`); idempotent force-abandon; finalize vs terminal → exactly one of COMPLETED/ABANDONED; `getChecklist` exposes photo ids/refs, never keys/bytes
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 2.5 · P11, P12, P13_

- [ ] 9. Started consumer & offer-terminal listener
  - [ ] 9.1 Implement ChecklistStartedConsumer
    - Create `services/api/src/checklist-photos/consumers/checklist-started.consumer.ts`: drain `service_started` rows unacked for `consumer_name = 'checklist'` (reuse Spec 17's `ServiceOutboxConsumerCheckpoint.drainUnacked('checklist', batch)` over `service_outbox`, ordered by `created_at`, bounded batch), call `createFromStarted(payload)`, then `ack(eventId, 'checklist')` (`ON CONFLICT DO NOTHING`). At-least-once + idempotent (dedup by `UNIQUE service_session_id`); row-scoped try/catch so one bad row never stalls the batch and never touches the already-committed start
    - _Requirements: 1.1, 1.2, 1.6 · P1, P2_
  - [ ] 9.2 Implement OfferTerminalChecklistListener
    - Create `services/api/src/checklist-photos/listeners/offer-terminal-checklist.listener.ts` (mirrors service-tracking's `OfferTerminalSessionListener`): on the offer/session's officially-defined terminal event, call `forceAbandonForSession(serviceSessionId, ...)` idempotently — reacts to those durable events, never a locally duplicated copy of Spec 17's state machine; introduces no new coupling
    - _Requirements: 4.4, 4.5 · P13_
  - [ ]* 9.3 Unit tests for consumer & listener
    - idempotent creation via its own `'checklist'` checkpoint (no shared marker on the upstream table), copying the event-carried policy snapshots (never live config), redelivery → still one run; failures isolated from the source flow; idempotent force-abandon
    - _Requirements: 1.1, 1.6, 4.4 · P1, P2, P13_

- [ ] 10. Cleanup & sweep jobs (eventual, idempotent, bounded)
  - [ ] 10.1 Implement RetentionCleanupProcessor
    - Create `services/api/src/checklist-photos/jobs/retention-cleanup.processor.ts` (BullMQ repeatable; interval/batch from config): select `checklist_task_photos` (joined to their run) whose `uploaded_at` is older than `CHECKLIST_PHOTO_RETENTION_DAYS` and whose object is not yet deleted (`findRetentionEligible`), call `deleteObjectSafe(object_key)` (idempotent), set `object_deleted_at` once; the metadata row + completion summary persist as audit (clock = `uploaded_at`)
    - _Requirements: 7.5, 6.1 · P15_
  - [ ] 10.2 Implement TombstoneDrainProcessor
    - Create `services/api/src/checklist-photos/jobs/tombstone-drain.processor.ts` (BullMQ repeatable): drain `checklist_photo_object_deletions` where `status='PENDING'` (`drainPending`, oldest first, batched) → `deleteObjectSafe(object_key)` → `markDone` (`processed_at = NOW()`); idempotent — this is how a photo whose only owning row cascaded away is still deleted
    - _Requirements: 7.2, 7.5 · P14_
  - [ ] 10.3 Implement StaleUploadGrantCleanupProcessor
    - Create `services/api/src/checklist-photos/jobs/stale-upload-grant-cleanup.processor.ts` (BullMQ repeatable; interval/batch from config): select expired/stale `ISSUED` grants (`findStaleGrants`, oldest first, batched), `deleteObjectSafe(object_key)` (idempotent — object may or may not exist), `markClosed` the grant `EXPIRED`/`CANCELLED` so it is no longer eternally `ISSUED` — closes the one orphan path (uploaded-but-never-finalized) neither retention nor the tombstone trigger reaches
    - _Requirements: 7.5, 6.1 · P15_
  - [ ] 10.4 Implement StuckRunSweep
    - Create `services/api/src/checklist-photos/jobs/stuck-run-sweep.processor.ts` (BullMQ repeatable): for `ACTIVE` runs whose parent session is already terminal-for-tracking past a threshold (missed terminal signal), single-winner `ACTIVE → ABANDONED` (`findStaleActiveRuns`); bounded, idempotent, defense-in-depth
    - _Requirements: 4.4, 4.5 · P13_
  - [ ]* 10.5 Unit tests for jobs
    - retention deletes only past-horizon objects (clock from `uploaded_at`), sets `object_deleted_at` once, metadata persists; tombstone drain idempotent (`processed_at` once); stale-grant cleanup deletes the orphan object + marks grant `EXPIRED`/`CANCELLED` (no-op on already-closed/already-deleted); stuck-run sweep single-winner ABANDONED, bounded
    - _Requirements: 7.2, 7.5, 4.4 · P13, P14, P15_

- [ ] 11. Controller, DTOs & module wiring
  - [ ] 11.1 Add checklist endpoints + DTOs
    - Create `services/api/src/checklist-photos/checklist.controller.ts` (`@UseGuards(JwtAuthGuard)`, whitelisting `ValidationPipe`; routes nested under `service-sessions/:id/checklist`) + DTOs (`mark-task.dto.ts`, `request-photo-upload.dto.ts`, `finalize-photo.dto.ts`): `GET /service-sessions/:id/checklist` (participant-gated reconciliation → run + ordered tasks + photo refs, ids not keys); `POST .../tasks/:taskId` (Cleaner + ACTIVE/window; `{ done }`); `POST .../tasks/:taskId/photo/request-upload` (Cleaner + gated + atomic slot reservation → `{ objectKey, uploadUrl, expiresAt }`); `POST .../tasks/:taskId/photo/finalize` (Cleaner + grant-gated + re-checked lifecycle + cap under the run lock; `{ objectKey, kind, sizeBytes?, mimeType?, width?, height? }` advisory); `GET .../photos/:photoId/playback-url` (participant-gated + session-scoped, cross-session → 404); `POST .../finalize` (Cleaner + precondition gated → COMPLETED + `checklist_completed`); identity from `req.user.keycloakId → userId`; non-participant → `403`, no existence disclosure
    - _Requirements: 1.5, 2.2, 2.3, 3.1, 3.3, 3.5, 4.1_
  - [ ] 11.2 Wire the checklist-photos module
    - Create `services/api/src/checklist-photos/checklist-photos.module.ts`: register the controller, all services, storage, the three repositories, the started consumer, the offer-terminal listener, the four processors + their BullMQ queues (reuse the existing Redis/BullMQ setup), and the new entities; call `validateChecklistPhotosConfig()` on boot; register the module in the app module
    - _Requirements: 6.1_
  - [ ]* 11.3 Endpoint integration tests
    - request-upload issues a grant then a scoped URL; finalize with a valid grant → persisted + published-progress; playback-url resolves key from DB and rejects a client-supplied key; non-participant → 403 on all endpoints; Host denied on mutate/upload/finalize but allowed to view evidence; task mutation / photo finalize on a terminal run → 409
    - _Requirements: 1.5, 2.2, 2.3, 3.5, 4.1 · P3, P4, P6, P9_

- [ ] 12. Checkpoint — backend compiles, tests green, CI-equivalent
  - Ensure `services/api` typechecks, ESLint (`--max-warnings 0`) clean on touched files, and the full API suite passes; ask the user if questions arise.

- [ ] 13. Mobile core (types, api, store, photo capture)
  - [ ] 13.1 Create mobile checklist types & constants
    - Create `apps/mobile/src/screens/checklist/checklist.types.ts` (`ChecklistRun`, `ChecklistTask`, `TaskPhotoRef`, `kind`/`state` enums, `ConnectionStatus`) and `checklist.constants.ts` (routes/endpoints, i18n keys, client size pre-check via `EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES`, dark design tokens — no secrets, nothing security-sensitive hardcoded)
    - _Requirements: 5.5, 6.3_
  - [ ] 13.2 Implement usePhotoCapture
    - Create `apps/mobile/src/screens/checklist/usePhotoCapture.ts` (`expo-image-picker`/camera): capture with a client-side max-size pre-check (UX only; server authoritative); graceful camera-permission-denied handling (i18n explanation, never crash, never hard-block completing tasks that don't require a photo)
    - _Requirements: 5.1, 5.2_
  - [ ] 13.3 Implement checklist.api.ts + store
    - Create `apps/mobile/src/screens/checklist/checklist.api.ts` (`requestUpload → PUT to MinIO (direct) → finalize` composed as one action; `getPlaybackUrl(photoId)`; get checklist; mark task; finalize) and `checklist.store.ts` (Zustand): run + tasks + photo refs; optimistic task toggle + attached-evidence reconciled via `GET`; idempotent state application (ignore regressions/older/illegal transitions); never persists a bare object key
    - _Requirements: 5.2, 5.3, 5.4 · P11_
  - [ ]* 13.4 Unit tests for capture, api & store
    - capture max-size pre-check + permission-denied graceful degrade (photo-optional tasks still completable); api composes request-upload → PUT → finalize as one action; store optimistic toggle + attached-evidence reconciled via `GET`, ignores older/illegal transitions, never holds a bare object key
    - _Requirements: 5.1, 5.2, 5.3 · P11_

- [ ] 14. Mobile screens & i18n
  - [ ] 14.1 Implement ChecklistScreen (Cleaner) + ChecklistProgressScreen (Host) + components
    - Create `apps/mobile/src/screens/checklist/ChecklistScreen.tsx` (Cleaner: snapshotted checklist with per-task done toggles + before/after capture; a clear finalize affordance that surfaces any unmet precondition — which tasks/photos are missing — and on success hands off to the completion flow / Spec 20), `ChecklistProgressScreen.tsx` (Host: read-only live-ish `X/Y` progress, best-effort realtime, + participant-gated evidence viewing, reconciling via `GET`), and `components/TaskRow.tsx`, `EvidenceThumb.tsx`, `ProgressBar.tsx`; wire navigation from the in-progress-job entry point in both role navigators; dark BidClean tokens (`#00F5D4` accent for capture/finalize CTAs, `#0B0C10` bg, `#1F2833` cards)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ] 14.2 Add checklist i18n (en + es)
    - Create `apps/mobile/src/i18n/locales/en/checklist.json` and `es/checklist.json` (parity): task toggles, capture/permission, progress `X/Y`, evidence viewing, finalize + unmet-precondition reasons, error states
    - _Requirements: 5.5_
  - [ ]* 14.3 Unit/render tests for screens & components
    - Cleaner task toggles + capture flow; Host live-ish progress + participant-gated evidence viewing; finalize surfaces unmet preconditions; dark tokens; `en`/`es` i18n parity; MinIO/apiClient/WS mocked (zero real external calls)
    - _Requirements: 5.3, 5.5_

- [ ] 15. Checkpoint — full checklist UX integrated on mobile
  - Ensure capture + store + screens + navigation + i18n work together against mocks; mobile `tsc --noEmit` + ESLint + Jest clean; ask the user if questions arise.

- [ ] 16. Property-Based Tests (fast-check, min 100 iterations, tagged `// Feature: checklist-photos, Property N`)
  - [ ]* 16.1 Property 1 — Idempotent one-run-per-session creation
    - **P1** — **Validates: Requirements 1.1, 1.3, 1.6 · REQ-CP1** — random start payloads (incl. empty snapshot) × N redeliveries × concurrent interleavings: exactly one ACTIVE run per `service_session_id`; ordered tasks match the snapshot (no duplicates); `total_tasks` = snapshot length; redelivery/concurrent attempt is a no-op
  - [ ]* 16.2 Property 2 — Temporally-exact snapshot invariance
    - **P2** — **Validates: Requirements 1.2, 1.4, 3.6 · REQ-CP1, REQ-CP13** — random event-carried snapshot + event-carried policy snapshots × post-creation property/config mutations: tasks == event snapshot; policies == event-carried IN_PROGRESS values (not consume-time config); later edits never change the run
  - [ ]* 16.3 Property 3 — Participant isolation & role enforcement
    - **P3** — **Validates: Requirements 1.5, 2.3, 3.4 · REQ-CP2, REQ-CP6** — random (user, session, endpoint, role) tuples: access iff participant; mutation/upload iff Cleaner; Host read-only (may view evidence); else `403`, no disclosure; session id / object key never authorizes
  - [ ]* 16.4 Property 4 — Photo bytes are isolated
    - **P4** — **Validates: Requirements 3.2, 7.5 · REQ-CP3** — random uploads: no bytes in PG / through the API; bytes only in MinIO under an opaque server-generated key
  - [ ]* 16.5 Property 5 — Task-count invariant under concurrency
    - **P5** — **Validates: Requirements 2.1, 2.4, 7.4 · REQ-CP5, REQ-CP11** — random interleaved concurrent mark-done/undone across tasks in a run: `completed_tasks == COUNT(is_done=true)` after every commit; no lost updates; idempotent per final state
  - [ ]* 16.6 Property 6 — In-progress-gated task mutation
    - **P6** — **Validates: Requirements 2.2 · REQ-CP5** — random run/session lifecycle states: mark accepted iff run ACTIVE + session in window; else `409`, nothing changes
  - [ ]* 16.7 Property 7 — Key ≠ credential (grant before URL, single-use, scoped)
    - **P7** — **Validates: Requirements 3.1, 3.4 · REQ-CP2** — foreign/valid/expired/consumed grants × callers: grant persisted before the URL; finalize iff caller-issued unexpired ISSUED matching run/task; a bare key authorizes nothing; consumed/expired grant rejected on reuse
  - [ ]* 16.8 Property 8 — Max-photos-per-task cap under concurrency
    - **P8** — **Validates: Requirements 3.1, 3.6 · REQ-CP2, REQ-CP8** — random interleaved concurrent request-upload + finalize for one task × random cap: committed photos never exceed `max_photos_per_task_snapshot`; two concurrent request-uploads can't both pass (slot reserved by an ISSUED grant under the run lock); over-cap finalize → `409`
  - [ ]* 16.9 Property 9 — Server-authoritative validation, re-checked at finalize (run-locked)
    - **P9** — **Validates: Requirements 3.3 · REQ-CP4, REQ-CP14** — random real (size/type/dims) vs declared × run lifecycle at finalize × concurrent checklist finalize: insert iff grant valid AND run ACTIVE under the lock AND server-observed within bounds AND cap holds; declared never overrides; late finalize `409`; bad object `400`, grant unconsumed; no photo inserted after COMPLETED
  - [ ]* 16.10 Property 10 — Playback is session-scoped, key resolved server-side
    - **P10** — **Validates: Requirements 3.5 · REQ-CP2, REQ-CP6** — random (participant, photoId, cross-session photoId, client-supplied key): photo resolved via `photo→task→run WHERE service_session_id=:id`; cross-session photoId → `404`, no disclosure; participant-only; key from DB; client key ignored
  - [ ]* 16.11 Property 11 — Best-effort realtime, authoritative reconciliation
    - **P11** — **Validates: Requirements 2.5 · REQ-CP11** — random publish outcomes / dropped frames: durable per-task rows + `completed_tasks` identical; `GET` returns authoritative state; a lost frame never loses a completed task
  - [ ]* 16.12 Property 12 — Finalize uses the run's snapshotted precondition
    - **P12** — **Validates: Requirements 3.6, 4.2 · REQ-CP8, REQ-CP13** — random run states × snapshotted precondition/photo-policy × later config mutations: finalize iff snapshotted precondition holds against durable rows; invariant to live config; unmet → clear rejection, stays ACTIVE
  - [ ]* 16.13 Property 13 — Single-winner terminality + outbox atomicity (run-locked summary)
    - **P13** — **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 7.4 · REQ-CP7, REQ-CP9, REQ-CP11** — random concurrent finalize + terminal + concurrent finalize-photo actors: exactly one of COMPLETED/ABANDONED; COMPLETED writes `checklist_completed` atomically with a summary consistent with committed rows (a concurrent photo is counted in `photoCount` or rejected `409`, never omitted); no escrow/dispute/rating side effects
  - [ ]* 16.14 Property 14 — Deletion coherence (no cascade-from-users; cascade tombstones the key)
    - **P14** — **Validates: Requirements 7.2, 7.3 · REQ-CP10** — random run/photo graphs + participant deletion + parent cascade: user/property nulled + record retained; cascade tombstones each freed key (rolled back with a rolled-back delete); drain idempotent
  - [ ]* 16.15 Property 15 — Bounded retention + orphan-grant cleanup; config/secrets never hardcoded/leaked
    - **P15** — **Validates: Requirements 6.1, 6.2, 6.4, 7.5 · REQ-CP10, REQ-CP12** — random `uploaded_at` ages × stale/expired ISSUED grants (orphan objects) × config maps: retention deletes iff past horizon (clock = `uploaded_at`), `object_deleted_at` set once, metadata persists; stale-grant → orphan object deleted idempotently + grant `EXPIRED`/`CANCELLED` (never eternal ISSUED); validator throws on missing config; client payloads only presigned URLs; no keys/bytes in logs

- [ ] 17. DDL / Migration Tests
  - [ ]* 17.1 Schema, constraints & trigger tests
    - Constraints/indexes present (UNIQUE `service_session_id`, `UNIQUE (run_id, position)`, UNIQUE `object_key`, FK indexes, active-state index, retention index, grant `(status, expires_at)` + `(task_id)` indexes, `CHECK` on `state`/`kind`/grant `status` `ISSUED/CONSUMED/EXPIRED/CANCELLED`/count range); no `deleted_at` on metadata rows; `BEFORE DELETE` trigger tombstones the `object_key` on direct delete AND on CASCADE from `checklist_tasks`/`checklist_runs`/`service_sessions`/`offers`, and the tombstone rolls back with a rolled-back delete; user/property FKs are `ON DELETE SET NULL`
    - _Requirements: 7.1, 7.2, 7.3 · P14, P15_

- [ ] 18. Integration & Scenario Tests
  - [ ]* 18.1 Integration: creation, fan-out & empty snapshot (backend)
    - `service_started` → run created (`ACTIVE`) with snapshot tasks via the `'checklist'` checkpoint; redelivery → still one run; fan-out coexistence with the Spec 16 notifications + Spec 18 video consumers; empty snapshot → zero-task run, finalize allowed
    - _Requirements: 1.1, 1.3, 1.6 · P1, P2_
  - [ ]* 18.2 Integration: full flow + concurrency races (backend)
    - mark tasks (concurrent) → count invariant holds → request-upload → PUT MinIO → finalize-photo (server inspect) → playback-url (Host views) → finalize → `COMPLETED` + `checklist_completed`; concurrent request-uploads at the cap boundary → committed photos never exceed `max_photos_per_task_snapshot` (loser `409`); concurrent finalize-photo + finalize-checklist → photo committed before COMPLETED (in `photoCount`) or rejected `409`; late finalize after terminal → `409`; invalid/over-limit/cap-exceeded object → `403`/`400`
    - _Requirements: 2.1, 3.1, 3.3, 4.1 · P5, P8, P9, P13_
  - [ ]* 18.3 Integration: authorization, playback isolation & terminal races (backend)
    - non-participant denied on read/mark/upload/finalize/playback; Host denied on mutation but allowed to view evidence; cross-session playback (`photoId` from session B) → `404`, no disclosure; unmet snapshotted precondition → finalize rejected; offer/session terminal → force-`ABANDONED`; finalize vs terminal → exactly one terminal
    - _Requirements: 1.5, 2.3, 3.5, 4.2, 4.4, 4.5 · P3, P10, P12, P13_
  - [ ]* 18.4 Integration: retention, tombstone drain, stale-grant & deletion coherence (backend)
    - retention past horizon → object deleted, `object_deleted_at` set, metadata + summary retained; tombstone drain after cascade deletes the object idempotently; a stale `ISSUED` grant with an orphan object (finalize failed) → `StaleUploadGrantCleanupProcessor` deletes the object + marks the grant `EXPIRED`/`CANCELLED` (idempotent re-run); user deletion → participant/property FKs SET NULL, run retained
    - _Requirements: 7.2, 7.3, 7.5 · P14, P15_

- [ ] 19. Final Checkpoint — all tests pass, CI green, docs updated
  - Ensure the full API suite + mobile suite pass and CI-equivalent commands are green; update module READMEs (`services/api/src/checklist-photos/README.md`, `apps/mobile/src/screens/checklist/README.md`, note the new `service_outbox` `consumer_name='checklist'` checkpoint in the service-tracking README and the new `checklist_completed` event consumed by Spec 20/21), `docs/ARCHITECTURE.md` (add the checklist-photos module + a checklist/evidence flow diagram + the new MinIO `checklist-photos` bucket node + the `service_outbox` fan-out edge to the `'checklist'` consumer), `docs/CHANGELOG.md` (`[Unreleased]` entries per task group), a new ADR (next free number) recording the checklist-run-as-a-snapshot / event-carried policies / evidence-in-MinIO / session-scoped playback / key-as-grant / run-locked finalize serialization / completion-as-a-durable-fact / tombstone / stale-grant-cleanup decisions, `.env.example` (all `CHECKLIST_*` + `EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES`), and mark Spec 19 complete in `.kiro/specs/ROADMAP.md`; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (unit, property-based, DDL, integration, mobile).
- Each task references specific requirements; property/integration tests cite the design's P1–P15 and the requirements' REQ-CP1…REQ-CP14.
- **A checklist run is bound to the in-progress service session — not a new domain.** Its participants are exactly the session's `hostId`/`cleanerId`, resolved server-side; a session id or object key never authorizes.
- **Durable-event init:** the run is created by consuming the `service_started` outbox event via a `consumer_name='checklist'` checkpoint over Spec 17's `service_outbox` fan-out — never a synchronous call, never a poll, never reading `service_sessions.state`.
- **One temporal frontier:** the checklist snapshot AND the policies (`photo_required_policy`, `completion_precondition`, `max_photos_per_task`) are carried on the `service_started` event (captured as-of IN_PROGRESS) and copied onto the run — never re-read from the live property or live config at consume time.
- **Authority split:** PostgreSQL = source of truth for checklist progress + photo metadata; MinIO = source of truth for the photo bytes (private bucket, grant-gated pre-signed URLs); the snapshot = source of truth for what the job requires; the session lifecycle owns when checklist work is allowed; snapshotted policies own validation.
- **Key ≠ credential:** every object key is bound server-side to a single-use grant `{ run/task, issued-to Cleaner, expiry }`, persisted BEFORE the pre-signed PUT; request-upload reserves a per-task slot atomically under the run `FOR UPDATE` lock (`committed_photos + active ISSUED grants < max`), and finalize re-validates authz + lifecycle + cap under the same lock, so the cap is a hard invariant.
- **Run-locked serialization:** finalize-photo and finalize-checklist both take `SELECT ... FOR UPDATE` on the `checklist_runs` row, so a COMPLETED summary's `photoCount` never omits a committed photo.
- **Completion is recording, not settlement:** finalize emits `checklist_completed` (totals + photo count) in the same tx as `run → COMPLETED`; checklist-photos never releases escrow, resolves disputes, or rates — Spec 20/21 consume the fact via their own checkpoints.
- **Orphan/deletion:** a `BEFORE DELETE` trigger tombstones freed `object_key`s into `checklist_photo_object_deletions` so cascade never orphans a MinIO object; a stale-upload-grant job reaches the uploaded-but-never-finalized orphan path; deletion is always eventual/idempotent, never a synchronous cross-system DELETE. Participant/property FKs are `ON DELETE SET NULL` — deleting a user never destroys job history.
- **Out of scope:** inventing a checklist model (property `checklistItems` is snapshotted), escrow release / dispute resolution / rating (Spec 20/21), per-task Host approval / real-time Host gating, AI photo analysis, a permanent user photo gallery, routing photo bytes through the API, push delivery (Spec 16), and any change to the property/service-tracking/offer/escrow contracts beyond snapshotting the checklist at IN_PROGRESS and emitting `checklist_completed`.
- CI: backend jobs (API lint/typecheck, API tests) must stay green; mobile is verified locally (`tsc --noEmit` + ESLint + Jest).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "5.1", "5.2"] },
    { "id": 5, "tasks": ["5.3", "6.1", "7.1"] },
    { "id": 6, "tasks": ["6.2", "7.2", "7.3", "8.1"] },
    { "id": 7, "tasks": ["7.4", "8.2", "9.1", "9.2"] },
    { "id": 8, "tasks": ["9.3", "10.1", "10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["10.5", "11.1"] },
    { "id": 10, "tasks": ["11.2", "11.3"] },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 12, "tasks": ["13.4", "14.1", "14.2"] },
    { "id": 13, "tasks": ["14.3", "16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7", "16.8"] },
    { "id": 14, "tasks": ["16.9", "16.10", "16.11", "16.12", "16.13", "16.14", "16.15", "17.1"] },
    { "id": 15, "tasks": ["18.1", "18.2", "18.3", "18.4"] }
  ]
}
```

# Implementation Plan: Video Verification

## Overview

`video-verification` (Spec 18, Sprint 5 — Service Execution) adds an **on-arrival identity check**: when Spec 17's geofence confirms the Cleaner arrived (`service_arrived`), the Cleaner records a short arrival clip and an async worker compares its face against the Cleaner's **already-verified KYC selfie** (Spec 3), giving the Host a derived confidence indicator. It is **not a new domain** — it composes patterns already proven in sibling specs: the `voice-notes` authority split (bytes in MinIO / record in PostgreSQL / derived result never a gate) and key ≠ credential upload grant; the `kyc-verification` private-encrypted-bucket + scheduled-retention-cleanup pattern; the AI/FastAPI + typed client DeepFace pattern (Option A — the AI service has no storage credentials); and creation off the durable `service_arrived` fact drained via this module's own per-consumer checkpoint (`consumer_name = 'video'`).

Because the arrival video is biometric-adjacent, access is deliberately **more** minimal than voice notes: the Cleaner gets **upload-only**, the worker gets **server-side read**, and **no client — Cleaner or Host — ever receives a playback/download URL (there is no playback endpoint in v1)**. The Host is surfaced only a derived classification (verified / needs-review / unavailable), never the raw footage and never the raw `match_score`.

Implementation is bottom-up and dependency-ordered: config validation → DB migration (`verification_sessions`, `video_verification_upload_grants`, `video_verification_object_deletions`, `verification_outbox` + the `BEFORE DELETE` tombstone trigger) → entities/types → repositories → storage service + KYC reference reader → creation service + arrival consumer → upload flow (request-upload / finalize) controller+service → face-comparison worker + AI client → AI FastAPI `/verify-face` → sweeps + retention + tombstone-drain jobs → outbox result events → mobile (recorder, store, screens, i18n) → documentation. Everything is testable in CI (backend) and locally (mobile) with MinIO, BullMQ, Postgres, the AI service, and the WebSocket mocked — zero real external calls.

Key team-review decisions baked into these tasks: the **atomic `beginProcessing`/`retryProcessing`** (each fuses the attempt increment with a controlled state transition — there is NO standalone `claimProcessingAttempt`, so only the transition winner ever bumps the counter); **no re-recording and no `capture_attempt` in v1** (a single arrival attempt per session; only `processing_attempt` retries); **decision-bearing-only outbox emission** (MATCH/NO_MATCH/INCONCLUSIVE emit `verification_completed`; NO_MATCH/INCONCLUSIVE additionally emit `verification_flagged`; FAILED/EXPIRED/DISABLED emit nothing); and documenting the **finalize↔MinIO TOCTOU** as a known v1 limitation in the ADR.

Scope: single ephemeral arrival clip, advisory-not-a-gate comparison, short retention (24–48h from `uploaded_at`), no re-KYC, no certified liveness, no live-call recording/STT. See `requirements.md` (7 requirements + REQ-VV1…REQ-VV15) and `design.md` (P1–P14).

## Tasks

- [ ] 1. Backend config & schema
  - [ ] 1.1 Create video-verification constants with fail-fast config validation
    - Create `services/api/src/video-verification/video-verification.constants.ts` and `config/validate-video-verification-config.ts`: parse all `VIDEO_VERIFICATION_*` tunables (`ENABLED`, `MINIO_BUCKET`, `MAX_SIZE_BYTES`, `MAX_DURATION_MS`, `ALLOWED_MIME_TYPES`, `UPLOAD_URL_TTL_SECONDS`, `UPLOAD_GRANT_TTL_SECONDS`, `MATCH_THRESHOLD`, `AI_URL`, `TIMEOUT_MS`, `MAX_RETRIES`, `RETENTION_HOURS`, `UPLOAD_WINDOW_MS`, `STUCK_THRESHOLD_MS`, `SWEEP_INTERVAL_MS`, `SWEEP_BATCH_SIZE`, `CLEANUP_INTERVAL_MS`, `CLEANUP_BATCH_SIZE`) plus reused `MINIO_*` and the AI internal auth token; `validateVideoVerificationConfig()` fail-fast (skipped under `NODE_ENV=test`): bucket non-empty, positive TTLs/limits, non-empty MIME list, AI URL present when enabled, and **reject `MATCH_THRESHOLD ≤ 0` or `> 1`**; no hardcoded values in logic
    - _Requirements: 6.1, 6.2, 6.4 · REQ-VV12, REQ-VV8 · P14, P8_
  - [ ] 1.2 Create the video-verification schema migration
    - Create `services/api/src/migrations/<timestamp>-CreateVideoVerificationTables.ts` (reversible `up()`/`down()`, `IF NOT EXISTS`, table/column comments): (a) `verification_sessions` — UUID PK, `service_session_id` FK→`service_sessions` CASCADE **UNIQUE**, `offer_id` FK→`offers` CASCADE, `cleaner_id`/`host_id` FK→`users` **SET NULL**, nullable `object_key` (partial UNIQUE `WHERE object_key IS NOT NULL`), `state` VARCHAR default `PENDING_UPLOAD`, nullable `decision`, `match_score` NUMERIC(5,4), `match_threshold` NUMERIC(5,4) NOT NULL, `reference_source` default `KYC_SELFIE`, `processing_attempt` INT default 0, nullable `failure_reason`, `uploaded_at`/`processed_at`/`video_deleted_at` nullable timestamptz, `created_at`/`updated_at` — **NO `deleted_at`**; CHECK constraints for `state`/`decision`/`reference_source`/`failure_reason` and `CHECK (match_threshold > 0 AND match_threshold <= 1)` + `CHECK (match_score IS NULL OR (match_score BETWEEN 0 AND 1))`; indexes `idx_verification_sessions_active (state, updated_at) WHERE state IN ('PENDING_UPLOAD','UPLOADED','PROCESSING')`, `idx_verification_sessions_retention (uploaded_at) WHERE video_deleted_at IS NULL AND uploaded_at IS NOT NULL`, and FK indexes; (b) `video_verification_upload_grants` (`object_key` PK, `service_session_id` FK CASCADE, `issued_to_user_id` FK SET NULL, `status` default `ISSUED`, `expires_at`, nullable `consumed_verification_id` FK SET NULL, indexes on session and `(status, expires_at)`); (c) `video_verification_object_deletions` tombstone (`object_key` PK, `reason` default `ROW_DELETED`, `status` default `PENDING`, `created_at`, nullable `processed_at`, index `(status, created_at)`) + `video_verification_tombstone_object()` function + `BEFORE DELETE` trigger on `verification_sessions` that inserts the freed `object_key` (`ON CONFLICT DO NOTHING`, only when `object_key IS NOT NULL AND video_deleted_at IS NULL`); (d) `verification_outbox` (`event_id` UNIQUE, `aggregate_type` default `verification_session`, `aggregate_id`, `type`, `payload` JSONB, `version` default 1, `created_at`; index `(created_at)`; no `relayed_at`)
    - _Requirements: 7.1, 7.2, 7.3, 7.5 · REQ-VV1, REQ-VV10, REQ-VV3 · P1, P3, P10_

- [ ] 2. Entities & domain types
  - [ ] 2.1 Create video-verification entities
    - Create `services/api/src/video-verification/entities/verification-session.entity.ts` plus grant/object-deletion/outbox entities mirroring the KYC/voice-note entity conventions (timestamptz, snake_case, `@Unique`/`@Index` matching the migration, CHECKs for `state`/`decision`/`reference_source`/`failure_reason`/grant `status`/tombstone `status`); assert **no `deleted_at`** on the session entity
    - _Requirements: 7.1_
  - [ ] 2.2 Create domain types, constants & error strings
    - Create `services/api/src/video-verification/video-verification.types.ts` (`VerificationState`, `Decision`, `FailureReason`, `ReferenceSource`, `UploadTarget`, `InspectResult`, `ArrivalPayload`, `VerificationView`, the state→classification map `verified|needs-review|unavailable`) and error strings; guarantee the view type has NO `match_score` and NO video URL field (compile-time enforcement of REQ-VV15)
    - _Requirements: 3.8, 4.3, 5.2 · REQ-VV15 · P13_

- [ ] 3. Repositories (single-winner writes, atomic attempts, tombstone drain)
  - [ ] 3.1 Implement VerificationRepository
    - Create `services/api/src/video-verification/repository/verification.repository.ts` (parameterized SQL only): `createFromArrival(params)` idempotent `INSERT ... ON CONFLICT (service_session_id) DO NOTHING`; `transition(id, expected, next, derivedFields, outboxEvents, manager)` single-winner `UPDATE ... WHERE id=:id AND state=:expected` that sets derived fields AND writes `verification_outbox` row(s) **only for decision-bearing terminals** in one transaction; `beginProcessing(id)` the ONE atomic write `SET state='PROCESSING', processing_attempt = processing_attempt + 1 WHERE id=:id AND state='UPLOADED' RETURNING processing_attempt` (returns attempt to winner, `null`/no-bump to losers); `retryProcessing(id, stuckBefore)` `SET processing_attempt = processing_attempt + 1 WHERE id=:id AND state='PROCESSING' AND updated_at < :stuckBefore RETURNING processing_attempt`; `writeResultGuarded(id, attempt, {decision, matchScore}, next, outboxEvents)` applies the terminal only if `attempt` is the latest; `findById`, `findByServiceSessionId`, `findExpirableUploads(before)`, `findStuckProcessing(before)`, `findRetentionEligible(before, limit)` — **no state-independent attempt-claim method exists**
    - _Requirements: 1.1, 1.5, 3.4, 3.7, 7.4 · REQ-VV1, REQ-VV6, REQ-VV9 · P1, P6, P9_
  - [ ] 3.2 Implement UploadGrantRepository & ObjectDeletionRepository
    - Create `repository/upload-grant.repository.ts`: `createGrant({ objectKey, serviceSessionId, issuedToUserId, expiresAt })` (status `ISSUED`, persisted before URL mint); `findConsumable(objectKey, manager)` (exists, ISSUED, unexpired, inside the finalize tx); `markConsumed(objectKey, verificationId, manager)`; `findStaleGrants(now, limit)`. Create `repository/object-deletion.repository.ts`: `findPending(limit)`, `markDone(objectKey)` for the tombstone drain — parameterized SQL only
    - _Requirements: 2.1, 7.2 · REQ-VV2, REQ-VV10 · P2, P10_
  - [ ]* 3.3 Unit tests for repositories
    - `beginProcessing` atomic `UPLOADED→PROCESSING` + attempt bump returns attempt to winner and `null` (no bump) to losers; `retryProcessing` bumps only from `PROCESSING` when stuck; `writeResultGuarded` accepts latest attempt, discards stale; `transition` writes outbox only for decision-bearing terminals; grant `findConsumable` rejects expired/consumed/foreign; scans select only eligible rows; assert no standalone attempt-claim path
    - _Requirements: 1.5, 3.4, 3.7, 7.4 · REQ-VV1, REQ-VV6, REQ-VV9 · P1, P6, P9_

- [ ] 4. Storage service & KYC reference reader
  - [ ] 4.1 Implement VerificationStorageService (MinIO)
    - Create `services/api/src/video-verification/storage/verification-storage.service.ts` (mirrors `kyc-storage.service`, `minio` client, private + server-side-encrypted bucket from config, ensure-bucket on init): `issueUploadTarget()` → `{ objectKey (crypto.randomUUID path), uploadUrl (presignedPutObject, upload TTL) }`; `inspectObject(objectKey)` → **authoritative** `{ exists, sizeBytes, contentType, durationMs }` (`statObject` for size/type, **real duration** probed from the container via `ffprobe`/media metadata; unprobeable ⇒ invalid); `readObject(objectKey)` server-side read used ONLY by the worker (Option A); `deleteObjectSafe(objectKey)` idempotent `removeObject`. **No `getPlaybackUrl` — there is deliberately no playback/download presign in v1**
    - _Requirements: 2.2, 2.3, 2.5, 4.1, 4.2 · REQ-VV3, REQ-VV4 · P3, P4_
  - [ ] 4.2 Implement KycReferenceReader
    - Create `services/api/src/video-verification/storage/kyc-reference-reader.ts`: `getVerifiedSelfie(cleanerId): { bytes } | null` — resolve the Cleaner's latest **VERIFIED** KYC selfie storage key (per Spec 3 status-derivation) and read it read-only from the KYC bucket; returns `null` when no VERIFIED selfie exists (drives the non-fatal INCONCLUSIVE/FAILED path); never mutates KYC
    - _Requirements: 3.1, 3.2 · REQ-VV14 · P12_
  - [ ]* 4.3 Unit tests for storage & reference reader
    - `inspectObject` returns server-observed size/type/real-duration and flags unprobeable/oversized/wrong-type; `deleteObjectSafe` idempotent (already-deleted handled); **assert no playback-presign method exists** on the storage service; `KycReferenceReader` returns bytes when VERIFIED and `null` when none; `minio` fully mocked
    - _Requirements: 2.3, 2.5, 3.2, 4.2 · REQ-VV3, REQ-VV4, REQ-VV14 · P3, P4, P12_

- [ ] 5. Creation service & arrival consumer (idempotent, off `service_arrived`)
  - [ ] 5.1 Implement VerificationCreationService
    - Create `services/api/src/video-verification/service/verification-creation.service.ts`: `createFromArrival(payload)` reads `VIDEO_VERIFICATION_ENABLED` + snapshots `match_threshold`, then `INSERT ... ON CONFLICT (service_session_id) DO NOTHING` — **enabled** ⇒ `PENDING_UPLOAD` with participants (`cleanerId`/`hostId`/`offerId`) copied and threshold snapshotted; **disabled** ⇒ `DISABLED` with NO grant, NO video, NO job, nothing gated (privacy-by-design); never throws into the batch (per-row try/catch), never touches the committed arrival
    - _Requirements: 1.1, 1.2, 1.5 · REQ-VV1, REQ-VV13 · P1, P11_
  - [ ] 5.2 Implement VerificationArrivalConsumer
    - Create `services/api/src/video-verification/consumers/verification-arrival.consumer.ts` (relay): drain `service_arrived` rows unacked for `consumer_name = 'video'` (reuse Spec 17 `ServiceOutboxConsumerCheckpoint.drainUnacked('video', batch)`, `NOT EXISTS`, ordered by `created_at`, bounded batch), call `createFromArrival(payload)` per row, then ack `(event_id, 'video')` (`ON CONFLICT DO NOTHING`); row-scoped try/catch so one bad row never stalls the batch; at-least-once + idempotent via `UNIQUE service_session_id`
    - _Requirements: 1.1, 1.4, 1.5 · REQ-VV1 · P1_
  - [ ]* 5.3 Unit tests for creation & consumer
    - enabled → PENDING_UPLOAD (threshold snapshotted, participants copied); disabled → DISABLED with grant repo never called and queue never called (P11); redelivery/concurrent create → exactly one row (P1); consumer acks only its own `(event_id,'video')` row; a creation failure leaves no ack and does not throw out of the batch
    - _Requirements: 1.1, 1.2, 1.5 · REQ-VV1, REQ-VV13 · P1, P11_

- [ ] 6. Upload flow (grant-gated, key ≠ credential, server-authoritative)
  - [ ] 6.1 Implement VerificationService (request-upload + finalize + reconcile)
    - Create `services/api/src/video-verification/service/verification.service.ts` and `service/verification-participation.service.ts`: `isParticipant(userId, verificationId)` resolves the row's `cleaner_id`/`host_id` (nulled participant ⇒ non-participant, row still retained); `requestUpload(id, userId)` asserts caller is the Cleaner AND `state = PENDING_UPLOAD` (else `409`), **persists the grant FIRST**, then mints the pre-signed PUT, returns `{ objectKey, uploadUrl, expiresAt }`; `finalizeUpload(id, userId, dto)` in a transaction verifies the grant (exists, `issuedTo`=caller, matching session, unexpired, ISSUED), server-inspects the object (authoritative size/type/real-duration; over-limit/wrong-type/unprobeable → `400`, nothing persisted, grant unconsumed), single-winner `PENDING_UPLOAD → UPLOADED` (set `object_key`, `uploaded_at`), marks grant CONSUMED, then after commit best-effort enqueues the comparison (skipped if DISABLED); `getVerification(id, userId)` participant-gated reconciliation returning authoritative state + derived classification (never `match_score`, never a video URL); functions ≤30 lines, SRP
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 3.8 · REQ-VV2, REQ-VV4, REQ-VV3, REQ-VV15 · P2, P4, P3, P13_
  - [ ] 6.2 Add VideoVerificationController, DTOs & module wiring
    - Create `video-verification.controller.ts` (`@Controller('video-verifications') @UseGuards(JwtAuthGuard)`, whitelisting `ValidationPipe`): `GET /:id` (participant-gated reconciliation), `POST /:id/request-upload` (Cleaner + PENDING_UPLOAD gated → `{ objectKey, uploadUrl, expiresAt }`), `POST /:id/finalize` (Cleaner + grant-gated; body `{ objectKey, durationMs?, sizeBytes?, mimeType? }` all advisory, server re-inspects) — **no playback/download route (by design)**; identity from `req.user.keycloakId → userId`, non-participant → `403` with no existence disclosure. Create `dto/request-upload.dto.ts`, `dto/finalize-upload.dto.ts` and `video-verification.module.ts` wiring repositories/services/storage/consumer/jobs, registering entities and BullMQ queues (reuse Redis/BullMQ setup), and calling `validateVideoVerificationConfig()` on boot
    - _Requirements: 1.3, 2.1, 2.4, 2.5, 6.1 · REQ-VV2, REQ-VV3 · P2, P3_
  - [ ]* 6.3 Unit tests for VerificationService & controller
    - request-upload requires Cleaner + PENDING_UPLOAD (DISABLED/terminal → 409); grant persisted before URL; finalize grant scoping (wrong caller/session/expired/consumed → 403/409); possession of a bare key never authorizes (P2); server-authoritative bounds (oversized/wrong-type/unprobeable → 400, nothing persisted, grant unconsumed — P4); single-winner UPLOADED transition + best-effort enqueue non-blocking; `GET` payload never contains `match_score` or a video URL (P13); no playback route exists (P3)
    - _Requirements: 1.3, 2.1, 2.3, 2.4, 2.5, 3.8 · REQ-VV2, REQ-VV4, REQ-VV3, REQ-VV15 · P2, P4, P3, P13_

- [ ] 7. Face comparison (async, best-effort, stale-safe, Option A)
  - [ ] 7.1 Implement FaceVerifyClient
    - Create `services/api/src/video-verification/ai-client/face-verify.client.ts` (+ `face-verify.types.ts`) mirroring `AiClientService` (axios, base URL + timeout from config, bounded retry/backoff, internal bearer + `X-Request-ID`): `compare(videoBytes, referenceBytes) → { score, decision }` posting BYTES (multipart) — Option A, no storage refs; typed errors for timeout/unavailable; never logs bytes/score
    - _Requirements: 3.1 · REQ-VV5, REQ-VV12 · P5, P14_
  - [ ] 7.2 Implement FaceComparisonProcessor
    - Create `services/api/src/video-verification/jobs/face-comparison.processor.ts` (BullMQ `video-face-comparison` queue): `begun = repo.beginProcessing(id)`; if `null` return (lost the transition, no side effects, no bump); `attempt = begun.attempt`; `storage.readObject(objectKey)` (deleted → `FAILED` `VIDEO_UNAVAILABLE`, no re-upload, no loop); `kycReader.getVerifiedSelfie(cleanerId)` (`null` → `INCONCLUSIVE`/`FAILED` `NO_REFERENCE`, non-fatal); `faceVerify.compare(...)` (timeout/unavailable → `FAILED` `AI_TIMEOUT`/`AI_UNAVAILABLE`, bounded retries); `decision = score >= snapshot(match_threshold) ? MATCH : NO_MATCH` using the **row's snapshot**, not live config; `repo.writeResultGuarded(id, attempt, ...)` latest-attempt-only, emitting `verification_completed` (+ `verification_flagged` on NO_MATCH/INCONCLUSIVE) in the same transaction; never blocks the service, seizes escrow, or changes KYC
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8 · REQ-VV5, REQ-VV6, REQ-VV8, REQ-VV14, REQ-VV9 · P5, P6, P8, P12, P9_
  - [ ]* 7.3 Unit tests for FaceVerifyClient & FaceComparisonProcessor
    - client posts bytes (not refs), retries transient, times out (mocked axios), typed errors; processor: `beginProcessing` null → no-op without side effects; deleted video → FAILED (no loop); null reference → INCONCLUSIVE/FAILED (non-fatal, no throw); AI error/timeout → FAILED bounded; decision vs snapshot threshold (invariant to live config); stale-attempt result discarded; emission decision-bearing only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8 · REQ-VV5, REQ-VV6, REQ-VV8, REQ-VV14 · P5, P6, P8, P12_

- [ ] 8. AI service — face-verify endpoint (FastAPI, DeepFace, Option A)
  - [ ] 8.1 Add POST /verify-face (DeepFace)
    - Create `services/ai/src/video_verification/` (`router.py`, `face_verify_service.py`, `models.py`, `config.py`, `__init__.py`): `POST /verify-face` accepts candidate (arrival video frame(s)) + reference (KYC selfie) BYTES (multipart), extracts a representative frame from the video, runs **DeepFace** (same library as `kyc-verification`'s `/ai/face-compare`), returns `{ score (0..1), decision (MATCH|NO_MATCH|INCONCLUSIVE) }` or a typed error (no face → INCONCLUSIVE); **no MinIO access/credentials (Option A)**; embeddings in-memory only, never persisted; reuse KYC internal bearer + `X-Request-ID`, config-driven model/threshold params; consistent with the existing FastAPI structure
    - _Requirements: 3.1 · REQ-VV5, REQ-VV12_
  - [ ]* 8.2 Tests for /verify-face
    - representative image pairs → match / non-match / no-face → INCONCLUSIVE (model stubbed/mocked in CI); score in `[0,1]`; embeddings not persisted (in-memory only); assert no MinIO client/credential path exists in the module
    - _Requirements: 3.1 · REQ-VV5_

- [ ] 9. Checkpoint — backend compiles, tests green, CI-equivalent
  - Ensure `services/api` typechecks, ESLint (`--max-warnings 0`) clean on touched files, the full API suite passes, and `services/ai` tests pass; ask the user if questions arise.

- [ ] 10. Sweeps, retention & tombstone drain (eventual, idempotent, bounded)
  - [ ] 10.1 Implement UploadWindowSweep & StuckProcessingSweep
    - Create `jobs/upload-window-sweep.processor.ts` (BullMQ repeatable): single-winner `PENDING_UPLOAD → EXPIRED` for rows older than `VIDEO_VERIFICATION_UPLOAD_WINDOW_MS` with no upload (idempotent; EXPIRED is a lifecycle terminal, emits no event). Create `jobs/stuck-processing-sweep.processor.ts`: for rows stuck `UPLOADED` past `VIDEO_VERIFICATION_STUCK_THRESHOLD_MS` re-enqueue (worker's own `beginProcessing` does the atomic transition + bump); for rows stuck `PROCESSING` past the threshold call `retryProcessing(id, stuckBefore)` (atomic attempt bump from PROCESSING) then re-enqueue with the returned attempt; bounded by `VIDEO_VERIFICATION_MAX_RETRIES` → single-winner `FAILED` (`MAX_ATTEMPTS`) after max; interval/batch from config
    - _Requirements: 2.6, 3.7 · REQ-VV7 · P7_
  - [ ] 10.2 Implement RetentionCleanupProcessor & TombstoneDrainProcessor
    - Create `jobs/retention-cleanup.processor.ts` (BullMQ repeatable, interval/batch from config, mirrors KYC cleanup): select rows `video_deleted_at IS NULL AND uploaded_at IS NOT NULL AND (now - uploaded_at) > VIDEO_VERIFICATION_RETENTION_HOURS`, `deleteObjectSafe(object_key)`, single-winner set `video_deleted_at` (result/score persists, record retained; clock = `uploaded_at`, never `created_at`/`processed_at`). Create `jobs/tombstone-drain.processor.ts`: drain `video_verification_object_deletions` `status='PENDING'` oldest-first batched → `deleteObjectSafe` → mark `DONE` (`processed_at = NOW()`); idempotent; drains keys freed by CASCADE
    - _Requirements: 4.2, 4.5, 7.2, 7.5 · REQ-VV3, REQ-VV10 · P3, P10_
  - [ ]* 10.3 Unit tests for sweeps, retention & tombstone drain
    - PENDING_UPLOAD→EXPIRED past window (idempotent, single-winner); UPLOADED/PROCESSING re-enqueued with newer attempt then FAILED after max (P7); retention deletes iff past horizon with clock from `uploaded_at`, sets `video_deleted_at` once, record + result retained (P3); tombstone drain idempotent, marks DONE (P10)
    - _Requirements: 2.6, 3.7, 4.2, 4.5, 7.2 · REQ-VV7, REQ-VV3, REQ-VV10 · P7, P3, P10_

- [ ] 11. Account-deletion & cascade coherence
  - [ ] 11.1 Confirm/align deletion policy
    - Verify participant FKs `cleaner_id`/`host_id` are `ON DELETE SET NULL` (Spec 13 invariant — never user-cascade); only `service_session_id`/`offer_id` CASCADE; the `BEFORE DELETE` trigger tombstones the freed `object_key` in the same transaction so the object is scheduled for deletion when a parent cascades; the record itself has no `deleted_at` (audit fact); document that no verification is destroyed merely because a participant is deleted
    - _Requirements: 7.2, 7.3, 7.5 · REQ-VV10 · P10_
  - [ ]* 11.2 Test deletion coherence (DDL + cascade)
    - deleting/anonymizing a participant nulls `cleaner_id`/`host_id` but keeps the verification + derived result; deleting the parent service session/offer cascades the row and tombstones the `object_key` (the tombstone rolls back with a rolled-back delete); user FKs are `ON DELETE SET NULL` (mirrors `chat-deletion-coherence.spec.ts`)
    - _Requirements: 7.2, 7.3, 7.5 · REQ-VV10 · P10_

- [ ] 12. Mobile core (recorder, types, api, store)
  - [ ] 12.1 Create mobile verification types & constants
    - Create `apps/mobile/src/screens/verification/verification.types.ts` and `verification.constants.ts`: verification state + derived classification (`recording|checking|verified|needs-review|unavailable`), max-duration UX pre-check from `EXPO_PUBLIC_VIDEO_VERIFICATION_MAX_DURATION_MS`, allowed formats, i18n keys; the store/view type never holds a `match_score` or a video URL
    - _Requirements: 5.2, 6.3 · REQ-VV15 · P13_
  - [ ] 12.2 Implement useArrivalRecorder
    - Create `apps/mobile/src/screens/verification/useArrivalRecorder.ts` (`expo-camera`): record with elapsed time + client-side max-duration pre-check (UX only, server authoritative); camera/mic permission-denial handled gracefully with an i18n explanation (never crash, never hard-block the service)
    - _Requirements: 5.1 · P14_
  - [ ] 12.3 Implement verification.api.ts + store actions
    - Create `apps/mobile/src/screens/verification/verification.api.ts` (`requestUpload → PUT to MinIO (direct) → finalize` composed as one action) and `verification.store.ts` (Zustand): state + derived classification, `reconcile` via `GET /:id`, idempotent state application (ignore regressions), never holds a video URL (there is none)
    - _Requirements: 5.2, 5.3 · REQ-VV3, REQ-VV15 · P3, P13_
  - [ ]* 12.4 Unit tests for recorder, api & store
    - recorder max-duration pre-check + permission-denied graceful degrade (no crash, service not blocked); `verification.api` composes request-upload → PUT → finalize as one action; store idempotent state application (ignores regressions), `reconcile` via GET, never holds a video URL
    - _Requirements: 5.1, 5.2, 5.3 · REQ-VV3, REQ-VV15 · P3, P13_

- [ ] 13. Mobile screens & i18n
  - [ ] 13.1 Implement ArrivalVerificationScreen (Cleaner) & ArrivalVerificationIndicator (Host)
    - Create `apps/mobile/src/screens/verification/ArrivalVerificationScreen.tsx` (Cleaner; shown when tracking session is ARRIVED and verification enabled; clear instruction "Say: Hi, I'm [name]...", record → upload; unobtrusive pending/failed state that never blocks proceeding) and `ArrivalVerificationIndicator.tsx` (Host; result indicator `recording|checking|verified|needs-review|unavailable`, never raw footage/score; `needs-review` presents a dispute path toward Spec 21, not an accusation/auto-cancel) plus `components/RecordButton.tsx`, `components/ResultBadge.tsx`; BidClean dark tokens (`#00F5D4` record CTA, `#0B0C10` bg, `#1F2833` cards)
    - _Requirements: 5.1, 5.2, 5.3, 5.4 · REQ-VV15 · P13_
  - [ ] 13.2 Add verification i18n (en + es)
    - Create `apps/mobile/src/i18n/locales/en/verification.json` and `es/verification.json` (parity): record/stop instruction, checking/verified/needs-review/unavailable, camera/mic-permission explanation, dispute-path label
    - _Requirements: 5.5_
  - [ ]* 13.3 Unit tests for screens
    - Host indicator renders per state (verified/needs-review/unavailable) and never shows footage/score (P13); needs-review shows a dispute path (no auto-cancel); Cleaner record→upload flow; dark tokens; `en`/`es` i18n parity; MinIO/apiClient/AI mocked
    - _Requirements: 5.2, 5.3, 5.4, 5.5 · REQ-VV15 · P13_

- [ ] 14. Checkpoint — full verification UX integrated on mobile
  - Ensure recorder + store + screens + i18n work together against mocks; mobile `tsc --noEmit` + ESLint + Jest clean; ask the user if questions arise.

- [ ] 15. Property-Based Tests (fast-check, min 100 iterations each)
  - [ ]* 15.1 Property: One verification per arrival, created idempotently (backend)
    - **P1** — **Validates: Requirements 1.1, 1.5, 7.1 · REQ-VV1** — random arrival payloads × N redeliveries × concurrent interleavings (enabled/disabled): exactly one row per `service_session_id`, correct initial state, threshold snapshotted, no second row, terminals immutable
  - [ ]* 15.2 Property: Participant isolation & key ≠ credential (backend)
    - **P2** — **Validates: Requirements 1.3, 2.1, 2.4 · REQ-VV2** — random (user, verification) pairs across endpoints; foreign/valid/expired/consumed grants: access iff participant; finalize iff caller-issued unexpired ISSUED grant matching the session; a bare key authorizes nothing
  - [ ]* 15.3 Property: Video isolation, no playback, short retention (backend)
    - **P3** — **Validates: Requirements 2.2, 2.5, 4.1, 4.2, 4.5, 3.8 · REQ-VV3** — random uploaded verifications × `uploaded_at` ages: bytes only in MinIO, no playback presign minted anywhere, delete iff past horizon (clock = `uploaded_at`), `video_deleted_at` set once, result persists
  - [ ]* 15.4 Property: Server-authoritative object validation (backend)
    - **P4** — **Validates: Requirements 2.3 · REQ-VV4** — random real (size, type, duration) vs arbitrary declared metadata: accept iff server-observed within bounds; declared never overrides; else `400`, nothing persisted, grant unconsumed
  - [ ]* 15.5 Property: Comparison is advisory, never a gate (backend)
    - **P5** — **Validates: Requirements 3.1, 3.5, 3.6 · REQ-VV5** — random terminal decisions incl. FAILED/INCONCLUSIVE/DISABLED/EXPIRED/NO_MATCH/MATCH: service/escrow/KYC untouched in all cases; NO_MATCH/INCONCLUSIVE emit exactly one `verification_flagged`; FAILED/EXPIRED/DISABLED emit no `verification_flagged` and no `verification_completed`
  - [ ]* 15.6 Property: Stale-safe monotonic attempts (backend)
    - **P6** — **Validates: Requirements 3.1, 3.4 · REQ-VV6** — random interleaved/concurrent `beginProcessing`/`retryProcessing` sequences: counter bumped only by the transition winner (losers no-op without bumping); attempts monotonic; only the latest attempt's result applied, older discarded
  - [ ]* 15.7 Property: No stuck verification (backend)
    - **P7** — **Validates: Requirements 2.6, 3.7 · REQ-VV7** — random ages/attempt counts/thresholds: PENDING_UPLOAD→EXPIRED past window; UPLOADED/PROCESSING re-enqueued then FAILED after max; idempotent; state recoverable via GET
  - [ ]* 15.8 Property: Threshold snapshot & range (backend)
    - **P8** — **Validates: Requirements 3.8, 6.4 · REQ-VV8** — random scores × snapshot thresholds × later config mutations: MATCH iff `s ≥ snapshot t`, NO_MATCH iff `s < t`; decision invariant to live config; s and t both in `[0,1]`
  - [ ]* 15.9 Property: Single-winner transitions + outbox atomicity (backend)
    - **P9** — **Validates: Requirements 7.4 · REQ-VV9** — random (from,to) edges × N concurrent actors: one winner sets derived fields + (decision-bearing only) outbox atomically; illegal edges rejected; terminals immutable; MATCH⇒score, completed⇒committed decision; FAILED/EXPIRED/DISABLED emit neither event
  - [ ]* 15.10 Property: Deletion coherence (backend)
    - **P10** — **Validates: Requirements 7.2, 7.3, 7.5 · REQ-VV10** — random verification graphs + participant deletion + parent cascade: host/cleaner nulled + record retained; cascade tombstones the key (rolled back with a rolled-back delete); drain idempotent
  - [ ]* 15.11 Property: Disabled ⇒ no video (backend)
    - **P11** — **Validates: Requirements 1.2 · REQ-VV13** — random payloads with enabled=false: DISABLED; grant repo never called; queue never called; nothing gated
  - [ ]* 15.12 Property: Missing-reference & deleted-video are non-fatal (backend)
    - **P12** — **Validates: Requirements 3.2, 3.3 · REQ-VV14** — random comparisons with null reference / deleted object: terminal INCONCLUSIVE/FAILED with reason, no exception; deleted → FAILED with zero re-enqueue
  - [ ]* 15.13 Property: Score internal / derived classification (backend + mobile)
    - **P13** — **Validates: Requirements 3.8, 4.3, 5.2 · REQ-VV15** — every verification state: Host surface exposes exactly one of {verified, needs-review, unavailable}; payload/view has no `match_score` and no footage URL
  - [ ]* 15.14 Property: No hardcoded config/secrets (backend)
    - **P14** — **Validates: Requirements 6.1, 6.2, 6.3, 6.4 · REQ-VV12** — random config maps incl. out-of-range thresholds: values from config; validator throws on missing / `threshold ≤ 0` / `> 1`; client payloads only presigned URLs; no bytes/score in logs

- [ ] 16. Integration & Scenario Tests
  - [ ]* 16.1 Integration: arrival → creation via the 'video' checkpoint (backend)
    - `service_arrived` → verification created (`PENDING_UPLOAD`) via the `consumer_name='video'` checkpoint; redelivery → still one row; fan-out coexistence with the Spec 16 notifications consumer (neither starves the other); disabled config → `DISABLED` with no grant/job
    - _Requirements: 1.1, 1.2, 1.4 · REQ-VV1, REQ-VV13 · P1, P11_
  - [ ]* 16.2 Integration: full upload → compare → decision + outbox (backend)
    - request-upload issues grant then scoped URL → PUT MinIO → finalize (server inspect authoritative) → `UPLOADED` → worker `beginProcessing` → AI (mocked) → `MATCH`/`NO_MATCH` + `verification_completed` (+ `verification_flagged` on NO_MATCH); non-participant denied on read/request-upload/finalize; no playback endpoint exists
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 3.1, 3.4, 3.8 · REQ-VV2, REQ-VV4, REQ-VV5, REQ-VV9 · P2, P4, P5, P9_
  - [ ]* 16.3 Integration: non-fatal paths, retention & deletion coherence (backend)
    - missing reference → `INCONCLUSIVE`/`FAILED`; deleted video → `FAILED` (no loop); AI down → `FAILED` (all emit no event); retention past horizon → object deleted, `video_deleted_at` set, record + result retained; tombstone drain after cascade; user deletion → participant FKs SET NULL, verification retained
    - _Requirements: 3.2, 3.3, 3.5, 4.2, 4.5, 7.2, 7.3 · REQ-VV14, REQ-VV5, REQ-VV3, REQ-VV10 · P12, P5, P3, P10_

- [ ] 17. Final Checkpoint — all tests pass, CI green, docs updated
  - Ensure the full API suite + AI suite + mobile suite pass and CI-equivalent commands are green; then update documentation: new `services/api/src/video-verification/README.md` (module purpose, endpoints, storage/grant/worker/sweeps, env vars, Option A) and `apps/mobile/src/screens/verification/README.md` (recorder/indicator, i18n, tokens); a `POST /verify-face` note in the AI service README (DeepFace, no storage creds); note the new `service_outbox` `consumer_name='video'` checkpoint in the service-tracking README and the new `verification_*` events in the push-notifications README; extend `docs/ARCHITECTURE.md` with the video-verification module, the verification-flow diagram (service_arrived → create → request-upload/grant → PUT MinIO → finalize → comparison worker → AI → decision + outbox → Host derived indicator; retention/tombstone edges), the new MinIO `verification-videos` bucket node and AI `/verify-face` edge; add `docs/CHANGELOG.md` `[Unreleased]` entries; add a new ADR `on-arrival-face-verification` (advisory-not-a-gate; arrival-video-in-MinIO with no playback + 24–48h retention from `uploaded_at`; key-as-grant; server-authoritative inspection incl. real duration; AI Option A; async best-effort comparison with the atomic `beginProcessing`/`retryProcessing` attempt-versioning + stuck sweep; deletion-tombstone-trigger; the not-certified-liveness scope limit REQ-VV11; and the **known v1 finalize↔MinIO TOCTOU limitation** with the object-version/ETag or write-once follow-up); document all `VIDEO_VERIFICATION_*` + `EXPO_PUBLIC_VIDEO_VERIFICATION_MAX_DURATION_MS` keys in `.env.example`; mark Spec 18 status in `.kiro/specs/ROADMAP.md`; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (unit, property-based, integration, DDL, mobile).
- Each task references specific requirements; property/integration tests cite the design's P1–P14 and the requirements' REQ-VV1…REQ-VV15.
- **Not a new domain:** a verification is a `verification_sessions` row bound 1:1 to a service session's arrival, inheriting participants + authorization from that session; it never re-runs or mutates KYC.
- **Authority split:** PostgreSQL = source of truth for the verification as an event; MinIO = source of truth for the arrival-video bytes; the DeepFace comparison = derived data, never authoritative, never a hard gate.
- **Object key ≠ credential:** every key is bound server-side to a single-use upload grant `{ serviceSessionId, issued-to Cleaner, expiry }`; finalize requires a valid unconsumed grant; there is NO playback URL for any client and no playback endpoint in v1.
- **Server-authoritative validation:** `inspectObject` decides real size/content-type/duration; client-declared metadata is advisory (UX pre-check only).
- **Atomic attempts (team-review decision):** there is NO standalone `claimProcessingAttempt` — `beginProcessing` fuses `UPLOADED → PROCESSING` with the increment, and `retryProcessing` fuses the stuck `PROCESSING` retry with the increment, so only the transition winner ever bumps `processing_attempt`; results are latest-attempt-guarded (stale-safe).
- **No re-recording / no `capture_attempt` in v1 (team-review decision):** exactly one arrival attempt per session; only *processing* retries reuse `processing_attempt`; a manual retry would be a separately-versioned design.
- **Decision-bearing-only outbox emission (team-review decision):** MATCH/NO_MATCH/INCONCLUSIVE emit `verification_completed`; NO_MATCH/INCONCLUSIVE additionally emit `verification_flagged`; FAILED/EXPIRED/DISABLED emit nothing.
- **Disabled ⇒ no video:** when disabled the record is `DISABLED`, no grant/video/job, nothing gated (privacy-by-design).
- **Non-fatal paths:** missing VERIFIED KYC selfie → INCONCLUSIVE/FAILED (never a throw, never a block); a retry finding the video deleted → FAILED with no re-upload and no loop.
- **Orphan/deletion:** a `BEFORE DELETE` trigger tombstones the freed `object_key` into `video_verification_object_deletions` so cleanup deletes MinIO objects even after CASCADE; retention + tombstone drains are eventual/idempotent, never a synchronous cross-system DELETE. Participant FKs are `ON DELETE SET NULL` (Spec 13 invariant); the record has no `deleted_at` (audit fact).
- **AI Option A:** the API worker reads MinIO and posts BYTES to `/verify-face`; the AI service has no storage credentials; embeddings are in-memory only.
- **Known v1 limitation:** finalize's MinIO inspection and the PostgreSQL transition are not a single cross-system transaction (TOCTOU window) — accepted for v1 given the short-lived, Cleaner/grant-bound presigned PUT; production hardening (object version/ETag verification or write-once uploads) is a tracked ADR follow-up.
- **Out of scope:** re-KYC / OCR / KYC-status change, hard-gating service or seizing escrow, certified liveness/anti-spoofing, long-term video retention or raw-footage playback, persisting biometric templates, giving the AI storage creds, live-call recording/STT/translation, push delivery (Spec 16).
- CI: backend jobs (API lint/typecheck, API tests, AI tests) must stay green; mobile is verified locally (`tsc --noEmit` + ESLint + Jest).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3", "8.1", "8.2"] },
    { "id": 7, "tasks": ["10.1", "10.2", "10.3", "11.1", "11.2"] },
    { "id": 8, "tasks": ["12.1", "12.2", "12.3", "12.4"] },
    { "id": 9, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 10, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8", "15.9", "15.10", "15.11", "15.12", "15.13", "15.14"] },
    { "id": 11, "tasks": ["16.1", "16.2", "16.3"] }
  ]
}
```

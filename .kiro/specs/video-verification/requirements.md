# Requirements Document

## Introduction

The `video-verification` module adds an **on-arrival identity check**: once the geofence confirms the Cleaner has reached the property (Spec 17's `service_arrived`), the Cleaner records a short arrival video ("Hi, I'm [name] for the cleaning service"), and the system compares the face in that video against the Cleaner's **already-verified KYC selfie** (Spec 3) to give the Host confidence that the person who arrived is the same verified professional they matched with. It is Spec 18 of Sprint 5 (Service Execution). It depends on kyc-verification (Spec 3, ✅) for the reference face and identity, and on service-tracking (Spec 17) for the arrival trigger.

**It reuses established patterns rather than inventing new ones.** The authority split mirrors `voice-notes`: **the arrival video bytes live in MinIO** (private bucket, short retention), **the verification record + result live in PostgreSQL**, and **the face-comparison result is derived data — never authoritative, never a hard gate on the service**. The storage/retention pattern mirrors the existing **KYC storage service** (private MinIO bucket, server-side encryption, idempotent `removeObject`, a scheduled cleanup job that deletes media past a retention horizon — the plan specifies verification video is deleted after 24-48h). The face comparison mirrors the **AI/FastAPI + typed client** pattern already used for other AI work, and runs **asynchronously and best-effort** like the Whisper transcription in voice-notes. The reference face is the Cleaner's **VERIFIED KYC selfie**, which already exists in the KYC bucket.

**A verification is bound to a service session, not a new domain.** When `service_arrived` fires for a session, a `verification_sessions` row is created for that service session, with participants exactly the session's `hostId`/`cleanerId`. Only the Cleaner records the arrival video; the Host sees the *result* (a confidence indication), never the raw video. Authorization derives from the service session's two parties, resolved server-side — never from client identity, an object key, or a session id.

**Authority split (kept strict):**
- **PostgreSQL is the source of truth for the verification as an event.** The `verification_sessions` row (participants, `serviceSessionId`, state, timestamps, the derived match result + score, retention/deletion bookkeeping) is durable. It never holds video bytes.
- **MinIO is the source of truth for the arrival-video bytes**, in a private bucket with short retention. **Access is deliberately minimal (biometric-adjacent artifact): the Cleaner has upload-only (a short-lived, grant-gated pre-signed PUT); the API worker has server-side read for processing; NO client — Cleaner or Host — ever receives a playback/download URL, and there is no playback endpoint in v1.** Possession of an object key is never authorization (the `voice-notes` upload-grant rule applies). After upload, the only reader is the server-side worker.
- **A verification is a single per-arrival attempt.** There is exactly one `verification_sessions` per service session (`UNIQUE service_session_id`), representing the single arrival-verification attempt for that arrival in v1. At most **one active capture attempt** exists at a time; *processing* retries reuse `processing_attempt` (they never create a new session). If re-recording is ever needed it is an explicit `capture_attempt` counter within the same session — never a second `verification_sessions` row.
- **The face-comparison result is derived data — never authoritative and never a hard service gate.** DeepFace (in the AI/FastAPI service) produces a similarity score/decision asynchronously; it annotates the verification, informs the Host, and can flag for review, but a low score or a failed/never-run comparison **does not by itself block the service or seize the escrow** (that is a dispute/human decision, Spec 20/21). The KYC identity (Spec 3) remains the authoritative identity; this is an at-the-door confirmation, not a re-KYC.
- **The arrival event owns the trigger.** Verification is created in reaction to the durable `service_arrived` fact (Spec 17 outbox), not by service-tracking calling video-verification directly.

**Deliberate scope boundaries (to keep the MVP correct, private, and shippable):**
- **Confirmation, not re-KYC.** This compares the arrival face to the existing verified KYC selfie; it does not re-run document OCR, does not change KYC status, and does not create a second identity record. The KYC module remains the identity authority.
- **Best-effort, non-blocking.** The comparison is asynchronous and advisory. The service proceeds regardless; a failed/slow/disabled comparison never blocks the Cleaner from working or holds the payment. Low-confidence results surface for Host awareness and can seed a dispute — they do not auto-penalize.
- **Ephemeral video, short retention, deleted from `uploaded_at`.** The arrival video is stored briefly (configurable, default 24-48h, measured from `uploaded_at`) and then hard-deleted by a cleanup job; no long-term retention, no video ever shown to the Host as raw footage in v1 (the Host sees a derived classification, not the raw score). Only the derived result + score persists past retention.
- **Disabled ⇒ no video at all (privacy-by-design).** When face-verification is disabled by config, the verification record is created `DISABLED`, **no upload grant is issued, no video is captured or stored, no AI job runs**, and the service continues. Biometric-adjacent video is never captured when it cannot be used — there is no "capture but don't compare" mode.
- **Not liveness/anti-spoofing hardened.** Like the GPS threat model in Spec 17, this is a reasonable identity-confidence check, not a certified anti-spoofing/liveness system; a determined attacker presenting a photo is out of scope for the MVP (documented, not silently assumed). DeepFace provides face *comparison*, not certified liveness.
- **AI does not touch storage (Option A, from voice-notes).** The API worker reads the video from MinIO and sends frames/bytes to the AI `/verify-face` endpoint; the AI service has no MinIO credentials.
- **STT/translation/recording of the live call are out of scope** (those are chat/voip specs). This is a single short recorded arrival clip.
- **Correctness does not depend on immediate processing.** The verification state machine + `GET` reconciliation + a stuck-processing sweep (mirroring voice-notes' stuck-PENDING) are the guarantees; a lost enqueue never leaves a verification stuck forever.

## Domain Model Overview

```
service_sessions (Spec 17) ── durable event service_arrived (geofence crossing) ──► creates a verification
        │ 1:1 (one verification per service session's arrival)
        ▼
verification_sessions (new — the durable record; never the video bytes)
        id, service_session_id (FK → service_sessions ON DELETE CASCADE, UNIQUE),
        offer_id (denormalized FK → offers ON DELETE CASCADE), cleaner_id (FK → users ON DELETE SET NULL),
        host_id (FK → users ON DELETE SET NULL),
        object_key (nullable; the arrival-video object in MinIO, UNIQUE when set),
        state (PENDING_UPLOAD | UPLOADED | PROCESSING | MATCH | NO_MATCH | INCONCLUSIVE | FAILED | DISABLED | EXPIRED),
        match_score (nullable; derived similarity 0..1 — INTERNAL, not exposed raw to the Host),
        match_threshold (snapshot of config threshold used; validated 0 < threshold <= 1),
        capture_attempt (default 0; increments only if re-recording is allowed — same session, never a new row),
        processing_attempt (default 0; monotonic, stale-safe like voice-notes transcript_attempt),
        reference_source (KYC_SELFIE; which verified face was compared against),
        uploaded_at (nullable; RETENTION CLOCK starts here), processed_at (nullable), video_deleted_at (nullable),
        created_at, updated_at
        (NO deleted_at on the record; the record is an immutable audit fact — only the VIDEO is deleted by retention)

VIDEO BYTES (MinIO, private bucket verification-videos, short retention; reached via pre-signed URLs
   gated by a voice-notes-style upload grant { serviceSessionId, issued-to Cleaner, single-use, expiry }):
   upload:  Cleaner records → API mints grant + pre-signed PUT → Cleaner PUTs to MinIO directly
   the API never transports the video bytes on the hot path

FACE COMPARE (async, best-effort, Option A — AI has no storage creds):
   API worker reads object from MinIO → POST bytes to AI /verify-face { candidate, referenceKycSelfie }
   → DeepFace similarity → { score, decision } → annotate verification (attempt-guarded, stale-safe)
   reference = the Cleaner's VERIFIED KYC selfie (Spec 3), read from the KYC bucket by the worker

STATE MACHINE (durable, single-winner; result is advisory, never a hard gate):
   PENDING_UPLOAD → UPLOADED → PROCESSING → { MATCH | NO_MATCH | INCONCLUSIVE | FAILED }
   PENDING_UPLOAD → EXPIRED            (Cleaner never uploaded within the window)
   (DISABLED when face-verification is turned off by config → no job, no gate)
   every transition: UPDATE ... WHERE id=:id AND state=:expected (single-winner); attempt-guarded result write

RETENTION / CLEANUP (mirrors KYC cleanup job; clock from uploaded_at):
   a scheduled job hard-deletes verification-video objects where (now - uploaded_at) > VIDEO_VERIFICATION_RETENTION_HOURS
   (default 24-48h), sets video_deleted_at; idempotent removeObject; the derived result/score persists

ORPHAN DELETION (explicit tombstone — the voice-notes lesson, never lose the key):
   video_verification_object_deletions { object_key (PK), reason, created_at, processed_at (nullable) }
   a BEFORE DELETE trigger on verification_sessions inserts the freed object_key into this table IN THE SAME
   transaction as the delete/CASCADE, so the object survives the row's disappearance; the cleanup job drains
   PENDING tombstones (removeObject → processed_at). Object deletion is always eventual/idempotent.
   A processing retry that finds the video already deleted (retention/tombstone) → FAILED, no re-upload, no loop.

DURABLE EVENTS (outbox — consumed by Push/Spec 16, surfaced to Host, seed for dispute/Spec 21):
   verification_completed { verificationId, serviceSessionId, decision, score? }
   verification_flagged   { verificationId, serviceSessionId }   (NO_MATCH/INCONCLUSIVE → Host awareness)

RECONCILE PATH:
   GET /verification-sessions/:id   → current record + latest decision (authoritative state machine)
```

- A **verification** is a `verification_sessions` row bound 1:1 to a service session's arrival; it inherits participants + authorization from that session and never re-runs KYC.
- **Video bytes never transit the API hot path or PostgreSQL**; they live briefly in MinIO and are hard-deleted by retention. Only a derived result persists.
- **The comparison is derived + best-effort**; it never hard-blocks the service or seizes payment. Low confidence flags for Host awareness / dispute, not auto-penalty.
- **Both roles**: the Cleaner records the short arrival clip (mic/camera permission handled gracefully); the Host sees a verification *indicator* (verified / needs-review / unavailable), never raw footage.

## Glossary

- **Verification session** — a `verification_sessions` row: the durable record of the on-arrival identity check for one service session. Never holds video bytes.
- **Arrival video** — the short clip the Cleaner records at the door; stored briefly in MinIO, hard-deleted by retention; never shown to the Host as raw footage.
- **Reference face** — the Cleaner's VERIFIED KYC selfie (Spec 3), the face the arrival video is compared against; read from the KYC bucket by the worker.
- **Match result** — the derived `{ decision, score }` from DeepFace: `MATCH | NO_MATCH | INCONCLUSIVE`; advisory, never a hard gate.
- **Upload grant** — the voice-notes-style single-use binding of an object key to `{ serviceSessionId, issued-to Cleaner, expiry }`; possession of a key is never authorization.
- **Retention window** — `VIDEO_VERIFICATION_RETENTION_HOURS` (default 24-48h) after which the video object is hard-deleted; only the derived result persists.
- **Stuck-processing sweep** — the bounded sweep (mirroring voice-notes' stuck-PENDING) that re-enqueues or fails a verification left PROCESSING/UPLOADED too long, so nothing is stuck forever.
- **DISABLED** — the state when face-verification is turned off by config: the video may still be captured for the Host but no comparison job runs and nothing is gated.

## Requirements

### Requirement 1 — A verification exists for, and only for, an arrived service session

**User Story:** As a Host, I want the arriving Cleaner's identity confirmed at my door, so that I can trust the verified professional I matched with is the one who showed up.

#### Acceptance Criteria

1. WHEN `service_arrived` fires for a service session (Spec 17) THEN the system SHALL create exactly one `verification_sessions` row for that session (`UNIQUE service_session_id`) with `state = PENDING_UPLOAD`, participants copied from the session, and `match_threshold` snapshotted from config — idempotently (a redelivered event never creates a second verification). This one row is the single arrival-verification attempt for that arrival; processing retries reuse `processing_attempt` and re-recording (if enabled) increments `capture_attempt` within the same row — a second `verification_sessions` for the same service session SHALL NEVER be created.
2. WHEN face-verification is disabled by config THEN the verification SHALL be created in `state = DISABLED`, and — privacy-by-design — NO upload grant SHALL be issued, NO video SHALL be captured or stored, NO comparison job SHALL be enqueued, and nothing SHALL be gated (the service continues).
3. WHEN any verification endpoint is accessed THEN authorization SHALL be resolved server-side from the service session's `hostId`/`cleanerId`; a non-participant SHALL receive `403` and learn nothing.
4. WHEN there is no arrived service session THEN no verification SHALL exist and no upload SHALL be accepted.
5. WHEN more than one verification creation is attempted for the same service session THEN the `UNIQUE service_session_id` constraint SHALL guarantee at most one (idempotent).

### Requirement 2 — Arrival video upload (ephemeral, grant-gated, key ≠ credential)

**User Story:** As the arriving Cleaner, I want to record a quick arrival video, so that my presence and identity are confirmed without friction.

#### Acceptance Criteria

1. WHEN the Cleaner requests to upload the arrival video THEN the system SHALL (participant + PENDING_UPLOAD gated) persist a single-use upload grant `{ serviceSessionId, issued-to Cleaner, expiry }` BEFORE minting a short-lived pre-signed PUT URL, and return `{ objectKey, uploadUrl, expiresAt }` (mirroring voice-notes).
2. WHEN the Cleaner uploads THEN the video bytes SHALL go directly to the private MinIO bucket via the pre-signed URL; the API SHALL NOT transport the bytes on the hot path.
3. WHEN the upload is finalized THEN the send SHALL verify the grant inside a transaction (exists, issued to this Cleaner, matching session, unexpired, unconsumed), server-inspect the object (exists, size ≤ max, content-type is video, duration ≤ max — server-authoritative, client metadata advisory), transition `PENDING_UPLOAD → UPLOADED`, mark the grant consumed, and enqueue the async comparison (unless DISABLED); an invalid grant → `403`/`409`, an over-limit/wrong-type object → `400`, nothing persisted.
4. WHEN a non-participant, or anyone possessing only an object key, attempts to upload/finalize THEN it SHALL be denied; possession of a key SHALL NEVER authorize.
5. WHEN any client (Cleaner or Host) requests to view/download the arrival video after upload THEN there SHALL be NO such endpoint in v1: only the Cleaner's upload PUT and the server-side worker's read exist; no playback/download pre-signed URL is ever issued to any client (biometric-adjacent minimization).
6. WHEN the Cleaner never uploads within the configured window THEN a bounded sweep SHALL transition `PENDING_UPLOAD → EXPIRED` (best-effort, idempotent), so no verification is stuck awaiting an upload.

### Requirement 3 — Face comparison (async, best-effort, stale-safe, advisory)

**User Story:** As the platform, I want to compare the arrival face to the verified KYC selfie without blocking the service, so that the Host gets confidence while the job proceeds smoothly.

#### Acceptance Criteria

1. WHEN a video is UPLOADED and verification is enabled THEN an async worker SHALL claim a monotonic `processing_attempt`, read the video object from MinIO, read the Cleaner's VERIFIED KYC selfie (Spec 3) as the reference, and POST the bytes to the AI `/verify-face` endpoint (Option A — the AI service has no storage credentials).
2. WHEN no VERIFIED KYC selfie exists for the Cleaner (inconsistent/legacy state) THEN the worker SHALL transition the verification to `INCONCLUSIVE` (or `FAILED`) with a clear reason and SHALL NOT throw an unhandled exception or block the service; the missing reference is a non-fatal, advisory outcome.
3. WHEN a processing attempt reads the video and finds it already deleted (retention elapsed or tombstoned) THEN the verification SHALL become `FAILED` (video-unavailable), with NO automatic re-upload and NO retry loop.
4. WHEN the AI returns a result THEN the worker SHALL write `{ decision (MATCH|NO_MATCH|INCONCLUSIVE), match_score }` and transition `PROCESSING → MATCH|NO_MATCH|INCONCLUSIVE` ONLY IF its attempt is the latest (stale-update guard, mirroring voice-notes transcript_attempt); an older attempt's result SHALL be discarded.
5. WHEN the comparison fails, times out, or the AI is unavailable THEN the verification SHALL become `FAILED` (best-effort, bounded retries), and the service SHALL NOT be blocked; a `FAILED`/`INCONCLUSIVE` result never auto-penalizes.
6. WHEN the result is `NO_MATCH` or `INCONCLUSIVE` THEN the system SHALL emit `verification_flagged` (Host awareness + a possible dispute seed for Spec 21) but SHALL NOT by itself seize escrow, cancel the service, or change KYC status — the comparison is advisory, the KYC identity remains authoritative.
7. WHEN a verification is left UPLOADED/PROCESSING beyond the configured window (lost enqueue) THEN a bounded stuck-processing sweep SHALL re-enqueue with a new attempt (mirroring voice-notes stuck-PENDING), marking `FAILED` after max attempts, so nothing stays stuck forever.
8. WHEN the decision is written THEN `verification_completed { decision, score? }` SHALL be emitted (outbox); the score SHALL be compared against the snapshotted `match_threshold`, not a live config value; the Host is surfaced only a derived classification (verified / needs-review / unavailable), never the raw `match_score`.

### Requirement 4 — Video retention & privacy

**User Story:** As a user, I want my arrival video kept only as long as needed, so that my privacy is protected.

#### Acceptance Criteria

1. WHEN a verification video is stored THEN it SHALL live in a private MinIO bucket with server-side encryption (mirroring KYC storage), reachable only via short-lived participant-gated pre-signed URLs, never public.
2. WHEN `(now - uploaded_at) > VIDEO_VERIFICATION_RETENTION_HOURS` (default 24-48h; the retention clock starts at `uploaded_at`, not `created_at`/`processed_at`) THEN a scheduled cleanup job SHALL hard-delete the object (idempotent `removeObject`) and set `video_deleted_at`; the derived result/score persists but the footage does not (mirroring the KYC cleanup job).
3. WHEN the Host views the verification THEN it SHALL see only a derived indicator (verified / needs-review / unavailable), never the raw video footage, in v1.
4. WHEN video bytes or frames are handled THEN they SHALL NOT be logged, and no face embeddings or biometric templates SHALL be persisted beyond what the derived result requires (a score + decision, not a stored biometric template).
5. WHEN a verification record's video is deleted by retention THEN the verification record itself SHALL be retained as an audit fact (no `deleted_at` on the record; only the video object is removed).

### Requirement 5 — Mobile verification UX for both roles

**User Story:** As the arriving Cleaner I want to record a quick clip, and as the Host I want to see the confirmation, so that the door hand-off feels safe and smooth.

#### Acceptance Criteria

1. WHEN the Cleaner has arrived (ARRIVED state) and verification is enabled THEN the Cleaner app SHALL prompt for a short arrival video with a clear instruction ("Say: Hi, I'm [name]..."), handle camera/mic permission denial gracefully with an i18n explanation (never crash, never hard-block the service), and upload via the grant flow.
2. WHEN the Host opens the arrived job THEN the Host app SHALL show the verification state (recording / checking / verified / needs-review / unavailable) as a result indicator, never raw footage.
3. WHEN the comparison is pending or failed THEN the UI SHALL show an unobtrusive state and SHALL NOT block either party from proceeding with the service.
4. WHEN a `NO_MATCH`/`INCONCLUSIVE` is surfaced THEN the Host UI SHALL present it as "needs review" with a path toward a dispute (Spec 21), not as an automatic accusation or auto-cancel.
5. WHEN any UI text is rendered THEN it SHALL come from i18n keys with `en`/`es` parity and follow BidClean dark design tokens.

### Requirement 6 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want verification behavior, thresholds, and retention driven by configuration, so that the feature is portable, private, and leaks no secrets.

#### Acceptance Criteria

1. WHEN video-verification reads any tunable (`VIDEO_VERIFICATION_ENABLED`, `VIDEO_VERIFICATION_MINIO_BUCKET`, `VIDEO_VERIFICATION_MAX_SIZE_BYTES`, `VIDEO_VERIFICATION_MAX_DURATION_MS`, `VIDEO_VERIFICATION_ALLOWED_MIME_TYPES`, `VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS`, `VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS`, `VIDEO_VERIFICATION_MATCH_THRESHOLD`, `VIDEO_VERIFICATION_AI_URL`, `VIDEO_VERIFICATION_TIMEOUT_MS`, `VIDEO_VERIFICATION_MAX_RETRIES`, `VIDEO_VERIFICATION_RETENTION_HOURS`, `VIDEO_VERIFICATION_UPLOAD_WINDOW_MS`, `VIDEO_VERIFICATION_STUCK_THRESHOLD_MS`, sweep interval/batch) THEN it SHALL come from environment/config with none hardcoded, and a fail-fast `validateVideoVerificationConfig()` SHALL run at startup for required values.
2. WHEN MinIO credentials are used THEN they SHALL live only in server config (reusing `MINIO_*`), never shipped to the client except as time-boxed pre-signed URLs; the AI service SHALL have no storage credentials (Option A).
3. WHEN the mobile client needs config THEN it SHALL read only `EXPO_PUBLIC_VIDEO_VERIFICATION_MAX_DURATION_MS` (UX pre-check) and never embed secrets.
4. WHEN video/biometric data is handled THEN it SHALL never be logged, and the match threshold used SHALL be the value snapshotted on the verification (validated `0 < threshold <= 1` at config load, consistent with the score range), so config changes do not retroactively re-decide an existing verification.
5. WHEN a new backend module, migration, AI endpoint, MinIO bucket, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram + a verification flow, CHANGELOG, and an ADR for the on-arrival-face-verification decision, incl. the advisory-not-a-gate and 24-48h retention decisions) per the project documentation rules.

### Requirement 7 — Persistence, lifecycle, and integrity

**User Story:** As the platform, I want verification data modeled coherently and cleaned up correctly, so that history is truthful and privacy-respecting.

#### Acceptance Criteria

1. WHEN the `verification_sessions` table is created THEN it SHALL follow the project database standards: UUID PK, snake_case, `timestamptz`, explicit FK `ON DELETE` behavior, application-validated `VARCHAR` for `state`/`decision`/`reference_source` (not PG enums), `UNIQUE service_session_id`, `UNIQUE object_key` (when set), and indexes on every FK, on non-terminal `state` (sweep), and on the retention scan. The record SHALL NOT have a `deleted_at` (audit fact); only the video object is deleted by retention.
2. WHEN a verification's parent service session / offer cascades away THEN its `verification_sessions` row SHALL cascade (`service_session_id`/`offer_id` → CASCADE), and a `BEFORE DELETE` trigger SHALL insert the freed `object_key` into an explicit tombstone table `video_verification_object_deletions { object_key PK, reason, created_at, processed_at }` **in the same transaction as the delete/CASCADE** (mirroring voice-notes) so the object reference is never lost when the only row that held it disappears; the cleanup job drains PENDING tombstones with idempotent `removeObject`.
3. WHEN a user account is deleted THEN `cleaner_id`/`host_id` SHALL be `ON DELETE SET NULL` (Spec 13 invariant — never a user-cascade); the verification record is retained per retention policy, and no history is destroyed merely because a participant is deleted.
4. WHEN a verification transitions state THEN each transition SHALL be an atomic single-winner conditional write with its derived fields (`uploaded_at`/`processed_at`/`match_score`/`decision`/`video_deleted_at`) and outbox event, so history never observes a `MATCH` without a score or a `verification_completed` without a committed decision.
5. WHEN the arrival-video object is deleted (retention or CASCADE-tombstone) THEN deletion SHALL be eventual/idempotent (never a synchronous cross-system delete), mirroring the voice-notes cleanup model.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-VV1 — One verification per arrival; retries in-session.** Exactly one `verification_sessions` per service session (`UNIQUE service_session_id`), created idempotently in reaction to `service_arrived`; it is the single arrival attempt — processing retries reuse `processing_attempt`, re-recording (if enabled) increments `capture_attempt`, and a second session row is never created. Inherits participant isolation; never re-runs or mutates KYC. *(Req 1.1, 1.5, 7.1)*
- **REQ-VV2 — Participant isolation & key ≠ credential.** Upload/finalize/read authorized server-side from the session's parties; a single-use grant binds the object key; possession of a key never authorizes; a non-participant learns nothing. *(Req 1.3, 2.1, 2.4)*
- **REQ-VV3 — Video isolation, no playback, short retention.** Bytes live only in a private, encrypted MinIO bucket; the Cleaner has upload-only, the worker has server-side read, and NO client (Cleaner or Host) ever gets a playback/download URL (no playback endpoint in v1); bytes never touch the API hot path or PostgreSQL; hard-deleted after the retention window measured from `uploaded_at`; only a derived result persists; the Host sees a derived classification, never raw footage or the raw score. *(Req 2.2, 2.5, 4.1, 4.2, 4.3, 4.5, 3.8)*
- **REQ-VV13 — Disabled ⇒ no video.** When verification is disabled, the record is `DISABLED`, no grant is issued, no video is captured/stored, no job runs, and nothing is gated — biometric-adjacent data is never captured when it cannot be used. *(Req 1.2)*
- **REQ-VV14 — Missing reference is non-fatal; deleted-video retry fails cleanly.** No verified KYC selfie → `INCONCLUSIVE`/`FAILED` (never an exception, never a block); a processing retry that finds the video already deleted → `FAILED` with no re-upload and no loop. *(Req 3.2, 3.3)*
- **REQ-VV4 — Server-authoritative object validation.** Server-inspected size/content-type/duration decide acceptance; client metadata is advisory; over-limit/wrong-type → 400, nothing persisted. *(Req 2.3)*
- **REQ-VV5 — Comparison is derived, best-effort, advisory.** DeepFace runs async (Option A — no storage creds); a FAILED/INCONCLUSIVE/DISABLED comparison never blocks the service, seizes escrow, or changes KYC; a NO_MATCH only flags for Host awareness / dispute. *(Req 3.1, 3.3, 3.4, Introduction authority split)*
- **REQ-VV6 — Stale-safe attempts.** `processing_attempt` is monotonic; a result is written only if it is the latest attempt; an older attempt's result is discarded (mirrors voice-notes). *(Req 3.2)*
- **REQ-VV7 — No stuck verification.** A never-uploaded verification → EXPIRED; an UPLOADED/PROCESSING one past the window is re-enqueued then FAILED after max attempts; state is always recoverable via `GET`. *(Req 2.5, 3.5)*
- **REQ-VV8 — Threshold snapshot & range.** The decision compares the score to the `match_threshold` snapshotted at creation (validated `0 < threshold <= 1`), so a config change never retroactively re-decides an existing verification, and threshold and score share the same [0,1] range. *(Req 3.8, 6.4)*
- **REQ-VV15 — Score is internal.** `match_score` persists internally; the Host is exposed only a derived classification (verified / needs-review / unavailable), not the raw score, in v1. *(Req 3.8, 5.2)*
- **REQ-VV9 — Single-winner transitions + outbox.** Every state transition is an atomic single-winner conditional write with derived fields and its outbox event; history is always internally consistent. *(Req 7.4)*
- **REQ-VV10 — Deletion coherence.** `cleaner_id`/`host_id` are SET NULL (no user-cascade, Spec 13 invariant); parent cascade tombstones any remaining video for idempotent eventual deletion; the record persists as audit. *(Req 7.2, 7.3, 7.5)*
- **REQ-VV11 — Not certified liveness (no over-promise).** This is a face-comparison confidence check against the KYC selfie, not a certified anti-spoofing/liveness system; that limit is explicit. *(Introduction scope)*
- **REQ-VV12 — No hardcoded config/secrets.** Thresholds, TTLs, retention, AI URL, bucket come from config with fail-fast validation; MinIO creds never shipped to the client; the AI service has no storage creds; video/biometrics never logged. *(Req 6.1–6.4)*

## Non-Goals

- Re-running KYC / document OCR / changing KYC status — this confirms against the existing verified KYC selfie; KYC (Spec 3) stays the identity authority.
- Hard-gating the service or seizing escrow on a low/failed comparison — the result is advisory; enforcement is a dispute/human decision (Spec 20/21).
- Certified liveness / anti-spoofing — this is face comparison, not a certified presence system (documented limit).
- Long-term video retention, a video archive, or showing raw arrival footage to the Host — video is ephemeral (24-48h) and only a derived result persists.
- Persisting biometric templates/embeddings beyond the derived score+decision.
- Giving the AI service storage credentials (Option A: the API worker reads MinIO and sends bytes).
- Live-call recording, STT, or translation (chat/voip specs).
- Push notification delivery / OS wake-up — video-verification emits durable events; delivery is push-notifications (Spec 16).
- Any change to the KYC, service-tracking, offer, or escrow contracts beyond creating the verification in reaction to `service_arrived` and emitting its result events.

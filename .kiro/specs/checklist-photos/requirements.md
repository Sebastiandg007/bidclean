# Requirements Document

## Introduction

The `checklist-photos` module covers the **work itself**: while a service is `IN_PROGRESS` (Spec 17), the Cleaner works through the property's cleaning checklist, marking each task done and attaching before/after photo evidence, so that when the job is finished there is a truthful, structured record of what was completed. That record is what `service-completion` (Spec 20) uses to release escrow and what `dispute-system` (Spec 21) uses as evidence. It is Spec 19 of Sprint 5 (Service Execution), depending on service-tracking (Spec 17) for the in-progress session it hangs off of.

**It is initialized by a durable event, not a synchronous call.** `checklist-photos` does not expose a `create()` that service-tracking calls, and it does not poll `service_sessions`. It **consumes the durable `service_started` outbox event** emitted by Spec 17 when a session enters `IN_PROGRESS` (its own consumer checkpoint), and creates the run idempotently off that event. The event carries — or lets the consumer stably resolve — `serviceSessionId`, `offerId`, `propertyId`, `hostId`, `cleanerId`, and an unambiguous reference to the moment of start.

**The checklist snapshot is temporally exact.** The checklist is not invented here: the property already carries a Host-defined `checklistItems: string[]` (up to 30 items, 200 chars each — Spec 5). The snapshot `checklist-photos` uses SHALL correspond exactly to the property's checklist state **at the moment the session entered `IN_PROGRESS`, regardless of when the durable event is consumed**. Because the event may be processed later (10:00 IN_PROGRESS, 10:01 Host edits checklist, 10:02 consumer runs), the snapshot is carried on / referenced by the `service_started` event (captured in Spec 17's transaction that produced the transition), never re-read live from the property at consume time. Editing the property's checklist afterward never mutates an in-flight job's tasks.

**Photo storage mirrors the existing patterns.** It follows `PropertyPhotoService` + the `voice-notes` upload-grant model: **photo bytes live in MinIO**, uploaded directly via short-lived, participant-gated pre-signed URLs bound to a single-use grant (a key is never a credential); **the checklist progress + photo metadata live in PostgreSQL**; **the photo bytes never transit the API hot path**.

**A checklist run is bound to the in-progress service session — not a new domain.** Its participants are exactly the session's `hostId`/`cleanerId`; the Cleaner completes tasks and uploads evidence, the Host observes progress, and authorization derives from the service session, resolved server-side — never from client identity, an object key, or a session id.

**Authority split (kept strict):**
- **PostgreSQL is the source of truth for checklist progress + photo metadata.** The per-task completion rows (task text snapshot, done/undone, completed_at, attached photo references) and the photo metadata rows are durable. They never hold photo bytes.
- **MinIO is the source of truth for the photo bytes**, in a private bucket, reached only via short-lived, participant-gated pre-signed URLs bound to single-use upload grants. Possession of an object key is never authorization.
- **The checklist snapshot is the source of truth for what the job requires**, taken at session start from the property's `checklistItems`; the live property checklist is advisory after that and never retroactively changes an in-flight run.
- **The session lifecycle owns when checklist work is allowed.** Task completion + photo upload are permitted only while the session is `IN_PROGRESS` (or a defined completion-pending window); a terminal/closed session rejects further checklist mutation.

**Deliberate scope boundaries (to keep the MVP correct and shippable):**
- **A checklist run is a snapshot, not a live mirror.** Property checklist edits after session start do not change the in-flight tasks (mirrors the radius/threshold snapshot decisions in Specs 17/18).
- **Photos are evidence, not a gallery.** Before/after evidence attached to tasks; retention is longer than verification video (evidence may be needed for a dispute window) but is still bounded and configurable; photos are not a permanent user photo gallery.
- **Completion here is recording, not settlement.** `checklist-photos` records what was done and produces a durable completion summary; it does not release escrow, resolve disputes, or rate the service — those are Spec 20 (completion + release) and Spec 21 (disputes). It emits the durable facts they consume.
- **The Host does not gate task completion in real time.** The Cleaner marks tasks and uploads evidence; the Host observes. The Host's satisfaction decision is Spec 20. checklist-photos does not implement Host approval per-task in v1.
- **No AI photo analysis in this spec.** Photos are stored and shown as evidence; automated "is this clean?" analysis is out of scope (a possible later enhancement).
- **Correctness does not depend on immediate realtime.** Progress may be surfaced to the Host in real time (best-effort, reusing existing transport), but the durable per-task rows + `GET` reconciliation are the authority; a dropped realtime frame never loses a completed task.

## Domain Model Overview

```
service_sessions (Spec 17) ── durable event service_started (IN_PROGRESS, carries the checklist snapshot
        │ + serviceSessionId/offerId/propertyId/hostId/cleanerId) ──► checklist-photos consumer creates a run
        │ 1:1 (one checklist run per service session), snapshot = property checklist AT the IN_PROGRESS moment
        ▼
checklist_runs (new — the durable run for a session; snapshot of the property checklist + policies)
        id, service_session_id (FK → service_sessions ON DELETE CASCADE, UNIQUE),
        offer_id (denormalized FK → offers ON DELETE CASCADE),
        property_id (FK → properties ON DELETE SET NULL),
        total_tasks (INTEGER; snapshot count), completed_tasks (INTEGER; derived, kept in sync),
        photo_required_policy_snapshot (JSONB; the task-level photo policy frozen at run creation),
        completion_precondition_snapshot (JSONB; the run-level completion rule frozen at run creation),
        max_photos_per_task_snapshot (INTEGER; frozen at run creation),
        state (ACTIVE | COMPLETED | ABANDONED), created_at, updated_at
        -- policies are SNAPSHOTTED: a mid-service config change never re-validates an in-flight run
        │ 1:N
        ▼
checklist_tasks (new — per-task snapshot + completion; the durable checklist state)
        id, run_id (FK → checklist_runs ON DELETE CASCADE),
        position (INTEGER; order within the run), task_text (snapshot of the property item at start),
        is_done (BOOLEAN default false), completed_at (nullable),
        created_at, updated_at   (UNIQUE (run_id, position))
        │ 1:N
        ▼
checklist_task_photos (new — evidence metadata; never the bytes)
        id, task_id (FK → checklist_tasks ON DELETE CASCADE),
        run_id (denormalized FK → checklist_runs ON DELETE CASCADE, for run-scoped cleanup),
        object_key (UNIQUE; the photo object in MinIO), kind (BEFORE | AFTER | GENERAL),
        size_bytes, mime_type, width?, height?, uploaded_at, created_at
        (NO deleted_at on metadata; photo bytes deleted by retention/tombstone, metadata is audit)

PHOTO BYTES (MinIO private bucket checklist-photos; upload-grant gated like voice-notes):
   upload:  Cleaner requests → API persists single-use grant { runId/taskId, issued-to Cleaner, expiry }
            BEFORE minting a pre-signed PUT → Cleaner PUTs bytes directly to MinIO
   finalize: verify grant in a tx + server-inspect object (size/content-type/dimensions authoritative)
            → insert checklist_task_photos → mark grant consumed
   the API never transports the photo bytes on the hot path
   playback: participant-gated fresh pre-signed GET resolved from DB by photo id (never client key)

CHECKLIST OPERATIONS (only while session IN_PROGRESS; single-winner where it matters):
   markTask(taskId, done)      → toggle is_done + completed_at; recompute completed_tasks atomically
   attachPhoto(taskId, ...)    → via the grant/finalize flow above
   a task may be marked done with or without a photo (photo-required policy is per-config, see Req)

COMPLETION SUMMARY (durable fact consumed by Spec 20 completion + Spec 21 disputes, via outbox):
   checklist_completed { runId, serviceSessionId, totalTasks, completedTasks, photoCount }
   emitted when the Cleaner finalizes the checklist (run → COMPLETED); it is the record Spec 20 settles on

RETENTION / CLEANUP:
   checklist evidence photos retained for CHECKLIST_PHOTO_RETENTION_DAYS (dispute window), then hard-deleted;
   a BEFORE DELETE trigger tombstones freed object_keys into checklist_photo_object_deletions so cascade
   never orphans a MinIO object (the voice-notes lesson); deletion is eventual + idempotent

RECONCILE PATH:
   GET /service-sessions/:id/checklist  → run + tasks + photo refs (authoritative; realtime is advisory)
```

- A **checklist run** is a `checklist_runs` row bound 1:1 to an in-progress service session, holding a **snapshot** of the property's checklist as `checklist_tasks`; editing the property checklist afterward never changes the run.
- **Photo bytes never transit the API hot path or PostgreSQL**; they live in a private MinIO bucket via grant-gated pre-signed URLs; only metadata + completion state is durable.
- **Completion is a recorded fact, not settlement.** Finalizing the checklist emits `checklist_completed`, which Spec 20 uses to release escrow and Spec 21 uses as dispute evidence; checklist-photos itself never moves money.
- **Both roles**: the Cleaner marks tasks + uploads before/after evidence; the Host watches progress and later views evidence (participant-gated), reconciling via `GET`.

## Glossary

- **Checklist run** — a `checklist_runs` row: the durable, per-session instance of the property checklist, snapshotted at session start.
- **Checklist task** — a `checklist_tasks` row: one snapshotted item with its done/undone state, completion time, and attached photos.
- **Snapshot** — the copy of the property's `checklistItems` taken when the run is created; the run's tasks never change if the property checklist is later edited.
- **Task photo** — a `checklist_task_photos` row: metadata for one before/after/general evidence photo; the bytes live in MinIO.
- **Upload grant** — the voice-notes-style single-use binding of an object key to `{ run/task, issued-to Cleaner, expiry }`; possession of a key is never authorization.
- **Completion summary** — the durable `checklist_completed` fact (totals + photo count) emitted when the Cleaner finalizes; consumed by Spec 20/21.
- **Retention window** — `CHECKLIST_PHOTO_RETENTION_DAYS`, long enough to cover the dispute window, after which evidence photos are hard-deleted (metadata retained).

## Requirements

### Requirement 1 — A checklist run initialized from the property snapshot

**User Story:** As a Cleaner, I want the job's checklist ready when I start, so that I know exactly what to do and can record it.

#### Acceptance Criteria

1. WHEN `checklist-photos` consumes the durable `service_started` event (Spec 17, emitted when a session enters `IN_PROGRESS`; NOT a synchronous call and NOT polling) THEN it SHALL create exactly one `checklist_runs` row for that session (`UNIQUE service_session_id`) and snapshot the checklist into ordered `checklist_tasks` rows (`task_text` copied, `position` preserved), idempotently via its own consumer checkpoint (a redelivered event never creates a second run or duplicate tasks).
2. WHEN the run is created THEN the snapshot used SHALL correspond exactly to the property's checklist state **at the moment the session entered `IN_PROGRESS`**, regardless of when the event is consumed — the snapshot is carried on / referenced by the `service_started` event (captured in Spec 17's transition transaction), never re-read live from the property at consume time. It SHALL also snapshot the applicable policies (`photo_required_policy_snapshot`, `completion_precondition_snapshot`, `max_photos_per_task_snapshot`) so a mid-service config change never re-validates an in-flight run.
3. WHEN the property has an empty checklist THEN the run SHALL still be created (zero tasks) and completion SHALL be allowed (a service with no checklist items can still be finished), never erroring.
4. WHEN the property checklist is edited after the run is created THEN the run's tasks SHALL NOT change (snapshot semantics), so an in-flight job is stable.
5. WHEN any checklist endpoint is accessed THEN authorization SHALL be resolved server-side from the service session's `hostId`/`cleanerId`; a non-participant SHALL receive `403` and learn nothing.
6. WHEN more than one run creation is attempted for the same session THEN the `UNIQUE service_session_id` constraint SHALL guarantee at most one run.

### Requirement 2 — Marking tasks complete (in-progress only, single-winner)

**User Story:** As a Cleaner, I want to check off tasks as I finish them, so that progress is recorded truthfully.

#### Acceptance Criteria

1. WHEN the Cleaner marks a task done/undone THEN the system SHALL update `is_done` + `completed_at` and maintain the invariant that, **after every committed mutation (including concurrent mutations of different tasks in the same run), `completed_tasks == COUNT(*) of checklist_tasks WHERE is_done = true` for the run** — with no lost updates. (The mechanism — e.g. a derived count, row-lock, serializable update — is a design decision; the invariant is mandatory.)
2. WHEN a task is marked while the session is not `IN_PROGRESS` (or the allowed completion-pending window) THEN the mutation SHALL be rejected (`409`) and nothing SHALL change.
3. WHEN only the Cleaner may mutate task state THEN the Host SHALL be read-only on checklist progress (the Host observes; task completion is the Cleaner's action), enforced server-side.
4. WHEN a task is toggled repeatedly THEN the operation SHALL be idempotent per final state (marking done twice yields one done task, not a corrupted counter).
5. WHEN checklist progress changes THEN it MAY be surfaced to the Host in real time best-effort, but the durable per-task rows + `GET` reconciliation SHALL be the authority; a dropped realtime frame never loses a completed task.

### Requirement 3 — Photo evidence (ephemeral-bytes, grant-gated, server-validated)

**User Story:** As a Cleaner, I want to attach before/after photos to tasks, so that my work is evidenced; and as a Host, I want to see that evidence.

#### Acceptance Criteria

1. WHEN the Cleaner requests to upload a task photo THEN the system SHALL (participant + IN_PROGRESS gated) persist a single-use upload grant `{ run/task, issued-to Cleaner, expiry }` BEFORE minting a short-lived pre-signed PUT URL, and return `{ objectKey, uploadUrl, expiresAt }` (mirroring voice-notes).
2. WHEN the Cleaner uploads THEN the bytes SHALL go directly to the private MinIO bucket via the pre-signed URL; the API SHALL NOT transport the bytes on the hot path.
3. WHEN the upload is finalized THEN the system SHALL **re-evaluate authorization and lifecycle at finalize time** (not only at request-upload): verify the grant in a transaction (exists, issued to this Cleaner, matching run/task, unexpired, unconsumed) AND that the run is still `ACTIVE` and the session still in the allowed window; server-inspect the object (exists, size ≤ max, content-type an allowed image, dimensions probed — server-authoritative, client metadata advisory); insert `checklist_task_photos`; mark the grant consumed. A finalize arriving after the run is `COMPLETED`/`ABANDONED` (e.g. upload started at 09:59, run completed at 10:01, finalize at 10:02) SHALL be rejected (`409`) and nothing persisted; an invalid grant → `403`/`409`, an over-limit/wrong-type object → `400`.
4. WHEN a non-participant, or anyone possessing only an object key, attempts to upload/finalize/view THEN it SHALL be denied; possession of a key SHALL NEVER authorize.
5. WHEN a participant views a task photo THEN the system SHALL resolve the `object_key` from the DB by photo id (never client-supplied) and mint a fresh short-lived participant-gated pre-signed GET; the Host MAY view evidence (unlike the verification video, task evidence is meant to be seen by the Host).
6. WHEN photo/completion policies apply THEN they SHALL be split into two distinct, snapshotted concepts: a **task-level `photo_required_policy`** (which tasks need evidence to be marked done) and a **run-level `completion_precondition`** (what must hold for the run to reach COMPLETED). Both SHALL be evaluated against the **run's snapshotted policy** (frozen at creation), never a live config value — so a config change mid-service cannot invalidate a previously-valid in-flight checklist. When no policy is configured, a task MAY be completed without a photo and the run MAY complete with any progress. All policy values SHALL come from config, none hardcoded.

### Requirement 4 — Finalizing the checklist (durable completion fact)

**User Story:** As a Cleaner, I want to finish the checklist and hand the job off for the Host's confirmation, so that payment can proceed.

#### Acceptance Criteria

1. WHEN the Cleaner finalizes the checklist THEN the system SHALL transition the run `ACTIVE → COMPLETED` (single-winner conditional write), stamp completion, and emit a durable `checklist_completed { runId, serviceSessionId, totalTasks, completedTasks, photoCount }` outbox event in the same transaction.
2. WHEN finalization is requested but the run's **snapshotted** completion precondition is unmet (e.g. required tasks not done, or required photos missing per the run's snapshotted photo-required policy) THEN it SHALL be rejected with a clear reason and the run SHALL remain `ACTIVE`; the preconditions SHALL be the run's snapshot (Req 1.2), never a live config value.
3. WHEN the checklist is finalized THEN `checklist_completed` SHALL be the durable fact that `service-completion` (Spec 20) settles on and `dispute-system` (Spec 21) uses as evidence; checklist-photos SHALL NOT itself release escrow, resolve disputes, or rate the service.
4. WHEN the underlying session/offer emits its officially-defined terminal event (as defined by service-tracking / the offer lifecycle — `checklist-photos` reacts to those durable events, NOT a locally duplicated copy of Spec 17's state machine) before finalization THEN the run SHALL be force-transitioned to `ABANDONED` as an idempotent side effect, and further checklist mutation/finalize SHALL be rejected.
5. WHEN finalization races with a terminal transition THEN the single-winner conditional writes SHALL ensure a consistent outcome (exactly one of COMPLETED/ABANDONED wins), never both.

### Requirement 5 — Mobile checklist UX for both roles

**User Story:** As a Cleaner I want a clear checklist with photo capture, and as a Host I want to watch progress and review evidence, so that the job is transparent.

#### Acceptance Criteria

1. WHEN the session is IN_PROGRESS THEN the Cleaner app SHALL show the snapshotted checklist with per-task done toggles and before/after photo capture, handling camera permission denial gracefully with an i18n explanation (never crash, never hard-block completing tasks that do not require a photo).
2. WHEN the Cleaner captures a photo THEN the app SHALL upload it via the grant flow (request URL → PUT to MinIO → finalize) and reflect the attached evidence on the task optimistically, reconciling via `GET`.
3. WHEN the Host opens the in-progress job THEN the Host app SHALL show live-ish progress (X/Y tasks done, best-effort realtime) and allow viewing attached evidence photos (participant-gated), reconciling via `GET`.
4. WHEN the Cleaner finalizes THEN the app SHALL surface any unmet precondition clearly (which tasks/photos are missing) and, on success, reflect the COMPLETED state and hand off to the completion flow (Spec 20).
5. WHEN any UI text is rendered THEN it SHALL come from i18n keys with `en`/`es` parity and follow BidClean dark design tokens.

### Requirement 6 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want checklist and photo behavior driven by configuration, so that the feature is portable, private, and leaks no secrets.

#### Acceptance Criteria

1. WHEN checklist-photos reads any tunable (`CHECKLIST_PHOTO_MINIO_BUCKET`, `CHECKLIST_PHOTO_MAX_SIZE_BYTES`, `CHECKLIST_PHOTO_ALLOWED_MIME_TYPES`, `CHECKLIST_PHOTO_MAX_PER_TASK`, `CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS`, `CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS`, `CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS`, `CHECKLIST_PHOTO_RETENTION_DAYS`, `CHECKLIST_PHOTO_REQUIRED_POLICY`, `CHECKLIST_COMPLETION_PRECONDITION`, sweep interval/batch) THEN it SHALL come from environment/config with none hardcoded, and a fail-fast `validateChecklistPhotosConfig()` SHALL run at startup for required values.
2. WHEN MinIO credentials are used THEN they SHALL live only in server config (reusing `MINIO_*`), never shipped to the client except as time-boxed pre-signed URLs.
3. WHEN the mobile client needs config THEN it SHALL read only public `EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES` (UX pre-check) and never embed secrets.
4. WHEN photo data is handled THEN object keys SHALL be unguessable and never logged as sensitive, and no photo bytes SHALL be logged.
5. WHEN a new backend module, migration, MinIO bucket, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram + a checklist/evidence flow, CHANGELOG, and an ADR for the checklist-snapshot + evidence-photo decisions) per the project documentation rules.

### Requirement 7 — Persistence, lifecycle, and integrity

**User Story:** As the platform, I want checklist and evidence data modeled coherently and cleaned up correctly, so that the completion record is truthful and privacy-respecting.

#### Acceptance Criteria

1. WHEN the checklist tables are created THEN they SHALL follow the project database standards: UUID PKs, snake_case, `timestamptz`, explicit FK `ON DELETE` behavior, application-validated `VARCHAR` for `state`/`kind` (not PG enums), `UNIQUE service_session_id` on the run, `UNIQUE (run_id, position)` on tasks, `UNIQUE object_key` on photos, and indexes on every FK. Metadata rows SHALL NOT have a `deleted_at` (audit); only photo bytes are deleted by retention.
2. WHEN a run's parent session/offer cascades away THEN `checklist_runs`/`checklist_tasks`/`checklist_task_photos` SHALL cascade (`service_session_id`/`offer_id`/`run_id`/`task_id` → CASCADE), and a `BEFORE DELETE` trigger SHALL tombstone freed `object_key`s into `checklist_photo_object_deletions` in the same transaction so cascade never orphans a MinIO object (the voice-notes lesson); the cleanup job drains PENDING tombstones idempotently.
3. WHEN a user account is deleted THEN checklist rows SHALL follow the Spec 13 invariant: `property_id` and any user reference are `ON DELETE SET NULL` where applicable (never a user-cascade that destroys shared job history); the run/tasks are retained as the completion record.
4. WHEN a task or run transitions THEN each change SHALL be an atomic write with its derived fields (`is_done`/`completed_at`/`completed_tasks`/run `state`) and, on finalize, its outbox event, so history never observes a COMPLETED run whose `completed_tasks` disagrees with its tasks.
5. WHEN evidence photos are deleted (retention or CASCADE-tombstone) THEN deletion SHALL be eventual/idempotent (never a synchronous cross-system delete), mirroring the voice-notes cleanup model; the metadata + completion summary persist as audit.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-CP1 — Durable-event init + temporally-exact snapshot.** Exactly one `checklist_runs` per service session (`UNIQUE service_session_id`), created idempotently by consuming the durable `service_started` event (not a sync call, not polling); the task snapshot corresponds to the property checklist **at the IN_PROGRESS moment**, carried on the event, regardless of consume time; later property edits never change an in-flight run. *(Req 1.1, 1.2, 1.4, 1.6)*
- **REQ-CP13 — Policies are snapshotted.** The task-level photo-required policy, run-level completion precondition, and max-photos-per-task are frozen on the run at creation; a mid-service config change never re-validates an in-flight run. *(Req 1.2, 3.6, 4.2)*
- **REQ-CP14 — Finalize/authorization re-checked post-request.** Authorization + run-lifecycle are re-evaluated at finalize (not only at request-upload); a photo finalize after the run is COMPLETED/ABANDONED is rejected and nothing persisted. *(Req 3.3)*
- **REQ-CP2 — Participant isolation & key ≠ credential.** All checklist/photo actions authorized server-side from the session's parties; a single-use grant binds each object key; possession of a key never authorizes; a non-participant learns nothing. *(Req 1.4, 3.1, 3.4)*
- **REQ-CP3 — Photo bytes isolated.** Bytes live only in a private MinIO bucket via short-lived grant-gated pre-signed URLs, never the API hot path or PostgreSQL; only metadata + progress is durable. *(Req 3.2, 3.5, 7.5)*
- **REQ-CP4 — Server-authoritative photo validation.** Server-inspected size/content-type/dimensions decide acceptance; client metadata advisory; over-limit/wrong-type → 400, nothing persisted. *(Req 3.3)*
- **REQ-CP5 — In-progress-gated task mutation with a hard count invariant.** Task completion is allowed only while IN_PROGRESS; after every committed mutation (incl. concurrent mutations of different tasks) `completed_tasks == COUNT(is_done = true)` for the run with no lost updates; idempotent per final state. *(Req 2.1, 2.2, 2.4)*
- **REQ-CP6 — Cleaner mutates, Host observes.** Only the Cleaner toggles tasks / uploads photos; the Host is read-only on progress (but MAY view evidence). *(Req 2.3, 3.5)*
- **REQ-CP7 — Completion is a durable fact, not settlement.** Finalize emits `checklist_completed` (totals + photo count) in the same tx as run→COMPLETED; checklist-photos never releases escrow, resolves disputes, or rates. *(Req 4.1, 4.3)*
- **REQ-CP8 — Config-driven preconditions.** Photo-required and completion preconditions come from config; an unmet precondition blocks finalize with a clear reason; nothing hardcoded. *(Req 3.6, 4.2, 6.1)*
- **REQ-CP9 — Single-winner run terminality.** Finalize vs. offer-terminal race resolves to exactly one of COMPLETED/ABANDONED; never both; further mutation rejected after terminal. *(Req 4.4, 4.5)*
- **REQ-CP10 — Deletion coherence + evidence retention.** Parent cascade tombstones remaining photo objects for idempotent eventual deletion; user references are SET NULL (no user-cascade); evidence kept for the dispute window then hard-deleted; metadata/summary persist as audit. *(Req 7.2, 7.3, 7.5)*
- **REQ-CP11 — Progress consistency.** `completed_tasks` always equals the count of done tasks in the run; a COMPLETED run's summary matches its tasks; realtime is advisory, `GET` is authoritative. *(Req 2.1, 2.5, 7.4)*
- **REQ-CP12 — No hardcoded config/secrets.** Buckets, limits, TTLs, retention, policies come from config with fail-fast validation; MinIO creds never shipped to the client; photo bytes never logged. *(Req 6.1–6.4)*

## Non-Goals

- Inventing a checklist model — the property's `checklistItems` (Spec 5) is snapshotted; the Host authors the checklist there.
- Releasing escrow, resolving disputes, or rating the service — those are Spec 20 (completion + release) and Spec 21 (disputes); checklist-photos emits the durable facts they consume.
- Per-task Host approval / real-time Host gating of completion — the Cleaner records, the Host's satisfaction decision is Spec 20.
- AI "is it clean?" photo analysis — evidence photos are stored and shown, not auto-graded (possible later enhancement).
- A permanent user photo gallery — evidence is retained only for the dispute window, then hard-deleted (metadata persists).
- Routing photo bytes through the API or PostgreSQL, or exposing a public photo URL.
- Push notification delivery — checklist-photos emits durable events; delivery is push-notifications (Spec 16).
- Any change to the property, service-tracking, offer, or escrow contracts beyond snapshotting the checklist at IN_PROGRESS and emitting `checklist_completed`.

# ADR-017: Checklist Photos — Event-Carried Snapshot, MinIO Evidence, Run-Locked Terminality

## Status

Accepted

## Context

Spec 19 (`checklist-photos`, Sprint 5 — Service Execution) records **the work itself**: while a
service is `IN_PROGRESS` (Spec 17), the Cleaner works through the property's cleaning checklist,
marking tasks done and attaching before/after photo evidence. The resulting record is the durable
fact `service-completion` (Spec 20) settles escrow on and `dispute-system` (Spec 21) uses as
evidence.

Several decisions had to be made about how this module initializes, snapshots, stores evidence,
serializes concurrent writes, and cleans up — without introducing new coupling into service-tracking
or the offer/escrow contracts, and without inventing a checklist model (the property already carries
a Host-authored `checklistItems`, Spec 5).

## Decision

1. **Durable-event initialization, own checkpoint.** The run is created by consuming the
   `service_started` outbox event via a `consumer_name='checklist'` checkpoint over Spec 17's
   `service_outbox` fan-out (reusing `ServiceOutboxConsumerCheckpoint`, never duplicated). No
   synchronous call, no polling, never reading `service_sessions.state`. Creation is idempotent on
   `UNIQUE service_session_id`.

2. **One temporal frontier — event-carried checklist AND policy snapshot.** The checklist snapshot
   *and* the applicable policies (`photo_required_policy`, `completion_precondition`,
   `max_photos_per_task`) are captured as-of the IN_PROGRESS transition and carried on the
   `service_started` event (an **additive, backward-safe** payload extension). `createFromStarted`
   copies them onto the run — never re-reading the live property or live config at consume time. A
   later property edit or config change never re-validates an in-flight run. This mirrors the
   radius/threshold snapshot decisions in Specs 17/18.

3. **Evidence bytes in MinIO, metadata in PostgreSQL, key ≠ credential.** Photo bytes live only in a
   private `checklist-photos` MinIO bucket, uploaded directly via short-lived pre-signed PUT URLs
   bound to a single-use grant persisted **before** the URL is minted (the voice-notes model).
   Possession of an object key never authorizes. Bytes never transit the API hot path or PostgreSQL.

4. **Max-photos-per-task is a hard invariant via atomic per-task slot reservation.** `request-upload`
   reserves a slot under the run `FOR UPDATE` lock (`committed_photos + active ISSUED grants < max`)
   and `finalize-photo` re-validates the cap under the same lock — so two concurrent request-uploads
   can never both pass.

5. **Run-locked serialization of finalize-photo and finalize-checklist.** Both take
   `SELECT ... FOR UPDATE` on the `checklist_runs` row, so a `COMPLETED` run's summary `photoCount`
   never omits a committed photo: a racing photo finalize either committed before the transition (and
   is counted) or observes the terminal run and is rejected (`409`).

6. **Server-authoritative validation, re-checked at finalize.** Size, content-type, and dimensions
   are inspected server-side (client metadata advisory); lifecycle + grant + cap are re-checked under
   the lock at finalize. A finalize after `COMPLETED`/`ABANDONED` → `409`; a bad object → `400`,
   nothing persisted, grant left unconsumed (cleanup-eligible orphan).

7. **Session-scoped, participant-gated playback (the Host may view evidence).** Unlike the
   verification video, task evidence is meant to be seen by the Host. Playback resolves the photo via
   `photo → task → run WHERE run.service_session_id = :sessionId`: a cross-session `photoId` → `404`,
   the object key is resolved from the DB (never a client-supplied key).

8. **Completion is a durable fact, not settlement.** Finalize single-winner `ACTIVE → COMPLETED` and
   emits `checklist_completed { runId, serviceSessionId, totalTasks, completedTasks, photoCount }`
   into `checklist_outbox` in the same transaction. checklist-photos never releases escrow, resolves
   disputes, or rates — Spec 20/21 consume the fact via their own checkpoints.

9. **Single-winner terminality.** Finalize vs. an offer/session-terminal signal resolves to exactly
   one of `COMPLETED`/`ABANDONED` via conditional writes; `OfferTerminalChecklistListener` forces
   `ABANDONED` idempotently (reacting to the durable terminal event, never duplicating Spec 17's
   state machine). A `StuckRunSweep` backstops a missed terminal signal.

10. **Deletion coherence + eventual/idempotent object cleanup.** A `BEFORE DELETE` trigger tombstones
    freed `object_key`s into `checklist_photo_object_deletions` in the same transaction as the
    delete/CASCADE, so cascade never orphans a MinIO object (the voice-notes lesson). User/property
    references are `ON DELETE SET NULL` (no user-cascade destroys job history); session/offer/run/task
    references CASCADE. Metadata rows have **no `deleted_at`** (they persist as audit); only photo
    bytes are removed, by a retention job (`CHECKLIST_PHOTO_RETENTION_DAYS`, clock from `uploaded_at`)
    and a `StaleUploadGrantCleanupProcessor` that reaches the uploaded-but-never-finalized orphan
    (deleting the object and marking the grant `EXPIRED`/`CANCELLED`).

## Consequences

**Easier**
- An in-flight job is stable: neither a property edit nor a mid-service config change can change its
  tasks, policies, or validation.
- Spec 20/21 get a single durable, consistent completion fact; a checklist-photos failure never rolls
  back or blocks the start, the service, or the escrow.
- Concurrency correctness (count invariant, per-task cap, terminality, summary consistency) is a
  single serialization point (the run lock) plus single-winner conditional writes — easy to reason
  about and to property-test.
- No orphaned MinIO objects: three cleanup paths (retention, tombstone drain, stale-grant) cover
  every way an object can be freed.

**Harder / trade-offs**
- The `service_started` payload grew (additive) and service-tracking now performs a read-only
  cross-module `properties.checklist_items` lookup in `start()`. This is the minimal coupling that
  keeps the snapshot temporally exact; the alternative (the consumer re-resolving the checklist) would
  not be temporally exact if the property is edited between IN_PROGRESS and consume.
- Photo dimension probing downloads the object bytes server-side at finalize (bounded read) to be
  authoritative — a small cost paid once per photo, off the hot path.
- Evidence retention is longer than verification video (a dispute window), so storage is held longer;
  it remains bounded and configurable, and metadata persists as audit after the bytes are deleted.

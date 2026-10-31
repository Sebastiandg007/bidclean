# ADR-016: On-Arrival Face Verification (advisory, never a gate)

## Status

Accepted

## Context

Spec 18 (video-verification, Sprint 5 — Service Execution) adds an at-the-door identity confidence
check: once Spec 17's geofence confirms the Cleaner has arrived (`service_arrived`), the Cleaner
records a short arrival clip and the system compares that face against the Cleaner's **already
VERIFIED KYC selfie** (Spec 3) so the Host can trust that the person who showed up is the verified
professional they matched with.

The artifact is **biometric-adjacent video**, which raises privacy, retention, storage-authority,
and abuse questions beyond what voice notes (Spec 14) required. We also need this to never become a
new failure mode for the money path: a slow, failed, disabled, or low-confidence comparison must not
block the Cleaner from working or hold the escrow. We deliberately compose patterns already proven
in sibling specs rather than invent new ones.

## Decision

1. **Advisory, never a gate.** The DeepFace comparison result is derived data. It annotates the
   verification and informs the Host, and a `NO_MATCH`/`INCONCLUSIVE` may seed a dispute (Spec 21),
   but it **never** blocks the service, seizes escrow, or changes KYC status. The KYC identity
   (Spec 3) remains the identity authority. Enforcement of a bad result is a human/dispute decision.

2. **Arrival video in MinIO, record in PostgreSQL, no playback.** The video bytes live only in a
   private, server-side-encrypted `verification-videos` bucket; the durable `verification_sessions`
   row (participants, state, derived `{ decision, match_score }`, snapshot threshold, retention
   bookkeeping) lives in PostgreSQL and never holds bytes. Access is more minimal than voice notes:
   the Cleaner has **upload-only**, the worker has **server-side read**, and **no client — Cleaner or
   Host — ever receives a playback/download URL. There is no playback endpoint in v1.** The Host sees
   a derived classification (verified / needs-review / unavailable), never the footage or the raw
   `match_score`.

3. **Short retention from `uploaded_at`.** A scheduled cleanup job hard-deletes the video object once
   `(now − uploaded_at) > VIDEO_VERIFICATION_RETENTION_HOURS` (default 24–48h) and sets
   `video_deleted_at`. Only the derived result/score persists past retention; the record is an
   immutable audit fact with **no `deleted_at`**.

4. **Disabled ⇒ no video (privacy-by-design).** When `VIDEO_VERIFICATION_ENABLED` is false the
   verification is created `DISABLED` — no grant is issued, no video is captured/stored, and no job
   runs. Biometric-adjacent data is never captured when it cannot be used.

5. **Key ≠ credential.** Each server-generated object key is bound to a single-use upload grant
   `{ serviceSessionId, issued-to Cleaner, expiry }`, persisted **before** the pre-signed PUT is
   minted. Possession of a key never authorizes upload or finalize (the voice-notes rule).

6. **Server-authoritative object inspection.** finalize decides acceptance from server-observed
   size/content-type/**real duration** (probed from the container). Client-declared metadata is
   advisory; an over-limit/wrong-type/unprobeable object is rejected (400) with nothing persisted.

7. **AI contract Option A.** The API worker reads the video from MinIO and the VERIFIED KYC selfie
   from the KYC bucket, and POSTs both byte streams to the FastAPI `/verify-face` endpoint. The AI
   service has **no MinIO credentials**; embeddings exist only in memory and are never persisted.

8. **Async, best-effort, attempt-versioned comparison.** The worker performs a single atomic
   `beginProcessing` that fuses the `UPLOADED → PROCESSING` transition with a `processing_attempt`
   increment (`RETURNING` the new attempt). Only the transition winner bumps the counter; a loser
   no-ops without bumping, so it can never invalidate the winner's in-flight result. Results are
   written only if their attempt is the latest (stale-safe). A `StuckProcessingSweep` uses an
   explicit `retryProcessing` from `PROCESSING`, bounded by `VIDEO_VERIFICATION_MAX_RETRIES`, so a
   lost enqueue never leaves a verification stuck forever. The decision compares the score against
   the **snapshotted** `match_threshold` (validated `0 < t ≤ 1`), never live config.

9. **Decision-bearing-only outbox emission.** `MATCH`/`NO_MATCH`/`INCONCLUSIVE` emit
   `verification_completed`; `NO_MATCH`/`INCONCLUSIVE` additionally emit `verification_flagged`;
   `FAILED`/`EXPIRED`/`DISABLED` emit nothing. Events fan out to push-notifications (Spec 16).

10. **Deletion coherence + tombstone.** `cleaner_id`/`host_id` are `ON DELETE SET NULL` (Spec 13
    invariant — never a user-cascade); only `service_session_id`/`offer_id` CASCADE. A `BEFORE
    DELETE` trigger copies a freed `object_key` into `video_verification_object_deletions` in the
    same transaction as the delete/CASCADE, so a video whose only owning row disappeared is still
    deleted by the idempotent tombstone-drain job.

## Consequences

- **Easier:** privacy is strong (no playback, short retention, disabled ⇒ no capture); the money
  path is never coupled to a biometric comparison; the AI trust surface is small (single bucket
  owner); the state machine is recoverable via `GET` + sweeps; correctness does not depend on
  immediate processing.
- **Harder / accepted trade-offs:**
  - **Not certified liveness (REQ-VV11).** This is face *comparison* against the KYC selfie, not a
    certified anti-spoofing/liveness system; a determined attacker presenting a photo is out of
    scope for the MVP. Documented, not silently assumed.
  - **Known v1 TOCTOU limitation.** finalize inspects the MinIO object and then writes PostgreSQL,
    but MinIO is outside the DB transaction and the presigned PUT may still be valid, so the object
    could be overwritten after inspection but before the retention delete. Accepted for v1 because
    the presigned PUT is short-lived and bound to a single Cleaner/grant (small, time-boxed,
    single-writer blast radius). Production hardening — capturing an object version/ETag at
    inspection and verifying it, or a write-once/immutable upload — is a tracked follow-up.

# Video Verification (Spec 18)

## Purpose

On-arrival identity check. When Spec 17's geofence confirms the Cleaner arrived (`service_arrived`),
the Cleaner records a short arrival clip and an asynchronous DeepFace worker compares its face
against the Cleaner's **already VERIFIED KYC selfie** (Spec 3), giving the Host a derived confidence
indicator. The comparison is **advisory** — it never blocks the service, seizes escrow, or changes
KYC. The video bytes live briefly in a private MinIO bucket (no playback endpoint, 24–48h retention
from `uploaded_at`); PostgreSQL is the source of truth for the verification as an event.

## Files

| File | Responsibility |
|------|---------------|
| `video-verification.module.ts` | Nest module wiring (entities, BullMQ queue, schedule, reused checkpoint) + startup config validation. |
| `video-verification.controller.ts` | `GET /:id`, `POST /:id/request-upload`, `POST /:id/finalize` (JWT-guarded). No playback route. |
| `video-verification.types.ts` | States, decisions, failure reasons, classification map, error strings, view type (no score/URL). |
| `video-verification.constants.ts` | All `VIDEO_VERIFICATION_*` tunables + queue/job config (nothing hardcoded). |
| `verification-outbox.ts` | Decision-bearing-only outbox row builder (`verification_completed` / `verification_flagged`). |
| `config/validate-video-verification-config.ts` | Fail-fast startup validation (rejects threshold ≤ 0 / > 1; skipped in test). |
| `service/verification-creation.service.ts` | Idempotent `createFromArrival` (PENDING_UPLOAD / DISABLED). |
| `service/verification.service.ts` | request-upload (grant-first) / finalize (server-authoritative, single-winner) / reconcile. |
| `service/verification-participation.service.ts` | The single participation rule (cleaner/host resolution). |
| `repository/verification.repository.ts` | Single-winner transitions, atomic `beginProcessing`/`retryProcessing`, `writeResultGuarded`, scans. |
| `repository/upload-grant.repository.ts` | Single-use grants (key ≠ credential). |
| `repository/object-deletion.repository.ts` | Tombstone drain queries. |
| `storage/verification-storage.service.ts` | MinIO presign PUT / inspect (real size/type/duration) / read / delete. No playback presign. |
| `storage/video-duration.probe.ts` | Server-authoritative video duration probe (ISO-BMFF + Matroska/WebM). |
| `storage/kyc-reference-reader.ts` | Read-only VERIFIED KYC selfie resolver + reader. |
| `ai-client/face-verify.client.ts` | axios client posting BYTES to AI `/verify-face` (Option A, bounded retry). |
| `consumers/verification-arrival.consumer.ts` | Drains `service_arrived` under `consumer_name='video'` (reused checkpoint). |
| `jobs/face-comparison.processor.ts` | BullMQ worker: begin → read video + selfie → compare → guarded result. |
| `jobs/upload-window-sweep.processor.ts` | `PENDING_UPLOAD → EXPIRED` past the window. |
| `jobs/stuck-processing-sweep.processor.ts` | Re-enqueue UPLOADED/PROCESSING; FAIL after max attempts. |
| `jobs/retention-cleanup.processor.ts` | Hard-delete video past the horizon (clock = `uploaded_at`). |
| `jobs/tombstone-drain.processor.ts` | Delete freed objects after CASCADE, mark DONE. |
| `entities/*.entity.ts` | TypeORM entities for the four tables. |
| `WIRING.md` | Exactly what the orchestrator must edit in shared files to activate the module. |

## Dependencies

- **service-tracking (Spec 17):** reads `service_arrived` from `service_outbox` via its own
  `consumer_name='video'` checkpoint (reuses `ServiceOutboxConsumerCheckpoint` + `ServiceSessionRepository`).
- **kyc-verification (Spec 3):** reads the VERIFIED KYC selfie from the KYC bucket (read-only reference).
- **AI service (FastAPI):** `POST /verify-face` (DeepFace, Option A — no storage creds).
- **push-notifications (Spec 16):** consumes `verification_outbox` events.
- Infra: PostgreSQL, MinIO (`verification-videos` bucket), Redis/BullMQ.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/video-verifications/:id` | Participant-gated reconciliation: state + derived classification (never score/URL). |
| POST | `/video-verifications/:id/request-upload` | Cleaner + PENDING_UPLOAD gated: persists grant, returns `{ objectKey, uploadUrl, expiresAt }`. |
| POST | `/video-verifications/:id/finalize` | Cleaner + grant-gated: server-inspects the object, transitions UPLOADED, enqueues comparison. |

There is **no** playback/download endpoint in v1 (biometric-adjacent minimization).

## Environment Variables

See `WIRING.md` for the full list. All values come from `VIDEO_VERIFICATION_*` env vars with
fail-fast validation; MinIO credentials (`MINIO_*`, `KYC_MINIO_BUCKET`) and `AI_SERVICE_AUTH_TOKEN`
are reused. The AI service has no storage credentials (Option A).

## Notes

- **Advisory, never a gate.** A low/failed/disabled/never-run comparison never blocks the service.
- **Not certified liveness (REQ-VV11)** and a known v1 finalize↔MinIO TOCTOU limitation — see ADR-016.

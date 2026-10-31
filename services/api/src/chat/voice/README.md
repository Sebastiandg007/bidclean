# Voice Notes (Chat sub-module)

## Purpose

Adds recorded audio clips to the existing chat conversation as a first-class message type (spec `voice-notes`, Spec 14). A voice note is **not a new domain**: it is a `chat_messages` row with `type = 'VOICE'` (and `body IS NULL`) plus a 1:1 `chat_voice_notes` metadata row, so it inherits the conversation model, participant authorization, `sequence_number` ordering, payload-checked idempotency, keyset history, CLOSED-rejection, and best-effort Centrifugo transport from `realtime-chat` (Spec 13) unchanged.

This sub-module adds only what audio requires on top of that foundation:

1. **Audio bytes live in MinIO**, never in PostgreSQL and never through the API — moved over short-lived, participant-gated pre-signed URLs.
2. **An upload grant** binds each server-generated object key to `{ conversationId, issued-to user, single-use, expiry }`, so possession of a key authorizes nothing.
3. **Asynchronous, best-effort transcription** (Whisper.cpp in the AI/FastAPI service) attached to the note after send as a message update — never blocking send or playback, and stale-update-safe.

**Authority split (strict):** PostgreSQL is the source of truth for the message and its metadata; MinIO is the source of truth for the audio bytes (holds only the opaque object key); the transcript is derived data and is never authoritative.

## Files

| File | Responsibility |
|------|---------------|
| `voice.types.ts` | Internal domain contracts + non-sensitive error strings. Grant/tombstone status unions (`GrantStatus`, `ObjectDeletionStatus`), pre-signed target results (`UploadTarget`, `PlaybackTarget`), authoritative object probe (`InspectResult`), send params (`SendVoiceParams`), the idempotency fingerprint (`VoicePayloadFingerprint` + `buildVoiceFingerprint` / `fingerprintsEqual`, transcript fields deliberately excluded), transcript-attach params, and `VOICE_ERROR_MESSAGES`. Audio bytes and transcript text are never embedded in any error, log, or metric. |
| `voice.constants.ts` | Env-configurable tunables (bucket, max duration/size, allowed MIME list, pre-signed URL + grant TTLs, transcription flag/timeout/retries/backoff, AI service URL, cleanup interval/batch, stuck-PENDING + orphan-reconcile thresholds, BullMQ queue/job names + default job options) with sensible defaults and no hardcoded secrets. `validateVoiceNotesConfig()` fails fast on missing/invalid required values (skipped under `NODE_ENV=test`), mirroring `validateChatConfig()`. Shared `MINIO_*` and `AI_SERVICE_AUTH_TOKEN` are read via `ConfigService`, not redeclared here. |
| `voice-note-storage.service.ts` | Owns the `chat-voice-notes` MinIO bucket lifecycle and all pre-signed access (mirrors `PropertyPhotoService`, `minio` client). Audio bytes never transit the API: `issueUploadTarget()` mints an unguessable server-chosen key + a single-object short-lived pre-signed PUT URL; `getPlaybackTarget()` mints a short-lived participant-gated GET URL. `inspectObject()` is the AUTHORITATIVE validation of a stored object — real size/content-type from `statObject`, real duration probed from the fetched bytes (client metadata is advisory). `getObject()` returns bytes for Option-A transcription; `deleteObjectSafe()` is idempotent; `listObjectsOlderThan()` feeds the orphan reconciler. Never logs audio bytes or object contents. |
| `audio-duration.probe.ts` | `AudioDurationProbe` — server-authoritative duration read from a downloaded audio buffer by parsing container/codec headers (WAV `fmt `/`data` chunks; MPEG frame headers, ID3 skipped), with no heavyweight media dependency. Returns `null` for any buffer it cannot confidently probe as valid audio (the caller treats `null` as invalid/unsupported → 400, never "unbounded"). A NestJS provider so it can be mocked in tests; never logs audio bytes, only parse outcomes. |
| `entities/chat-voice-note.entity.ts` | `chat_voice_notes` — the 1:1 audio-metadata row for a `VOICE` message. Holds the opaque MinIO `objectKey` (UNIQUE) and the SERVER-OBSERVED duration/size/mime (authoritative probe values, not client-declared), plus derived transcript fields and a monotonic `transcriptAttempt` guard. Audio is immutable (no `deletedAt`); FK to `chat_messages` is UNIQUE, ON DELETE CASCADE. |
| `entities/voice-note-upload-grant.entity.ts` | `voice_note_upload_grants` — binds a server-generated unguessable `objectKey` (PK) to one conversation and the issuing user, single-use with a short expiry (key-as-grant, not credential). `conversationId` CASCADEs; `issuedToUserId` and `consumedMessageId` are SET NULL for deletion coherence. |
| `entities/voice-note-object-deletion.entity.ts` | `voice_note_object_deletions` — deletion tombstone. A `BEFORE DELETE` trigger on `chat_voice_notes` copies the freed `objectKey` here in the same transaction, so the key is captured atomically before the row (or its CASCADE) disappears; a cleanup worker later removes the MinIO object idempotently and marks the row `DONE`. |
| `upload-grant.repository.ts` | `UploadGrantRepository` — persists a grant (BEFORE the pre-signed URL is minted), reads it `FOR UPDATE` inside the send transaction (`findConsumable`), marks it `CONSUMED` (single-use), and selects/deletes expired-ISSUED grants for the cleanup sweep. Parameterized SQL only. |
| `voice-note.repository.ts` | `VoiceNoteRepository` — inserts the 1:1 metadata row inside the send transaction (server-observed values), loads a note / its transcription context (joined conversation id), claims a monotonic `transcript_attempt`, and attaches a transcript guarded by the latest-attempt rule (`attachTranscript` applies only when the attempt is not stale). `findStuckPending` / `markFailed` back the stuck-PENDING sweep. |
| `object-deletion.repository.ts` | `ObjectDeletionRepository` — drains `voice_note_object_deletions` tombstones (`findPending` → `markDone`) and reports whether a pending tombstone references an object (reconciler input). Idempotent. |
| `whisper.client.ts` | `WhisperClient` — posts the audio BYTES (multipart) to the AI `/transcribe` endpoint (Option A: no storage ref) with a bounded exponential-backoff retry; typed errors classify transient (5xx/network/timeout, retryable) vs deterministic (4xx). Mirrors `AiClientService`. Audio/transcript never logged. |
| `voice-transcription.processor.ts` | `VoiceTranscriptionProcessor` (BullMQ) — claims an attempt, fetches the object, calls Whisper, attaches the result guarded by the latest-attempt rule (`READY`/`FAILED`), and publishes a best-effort `voice_transcript_updated` message-update. `onFailed` marks `FAILED` after retry exhaustion; never fails/hides/duplicates the message. |
| `voice-note-cleanup.processor.ts` | `VoiceNoteCleanupProcessor` (repeatable `@Interval`) — four idempotent sweeps: (A) expired ISSUED grants + orphan objects, (B) tombstone drain, (C) reconciler backstop (aged, unreferenced objects), (D) stuck-PENDING re-enqueue then `FAILED` after the bounded max. Per-item errors are logged, never thrown. |

The parent chat module also gains: a `VOICE` branch in `ChatService.sendVoiceMessage` + `ChatRepository.insertVoiceMessage` (the Spec 13 serialized transaction with grant verify + authoritative object inspection woven in under the same lock), the `POST /chat/conversations/:id/voice-notes/upload-url` and `GET /chat/conversations/:id/voice-notes/:messageId/playback-url` endpoints, `dto/send-voice-message.dto.ts`, and provider/queue/schedule wiring in `chat.module.ts`.

## Dependencies

- **Chat module (parent)** — a voice note reuses the Spec 13 serialized send transaction, `sequence_number`, participant authorization, OPEN-lifecycle check, and Centrifugo publish. This sub-module extends that path with a `VOICE` branch; text send is untouched.
- **MinIO** — the `chat-voice-notes` bucket (private, no public read) stores audio bytes; the API mints short-lived pre-signed PUT/GET URLs. Reuses the shared `MINIO_*` credentials via `ConfigService`.
- **AI service (FastAPI)** — `POST /transcribe` runs Whisper.cpp. Transcription uses Option A: the API worker fetches the object from MinIO and posts the bytes; the AI service is given no storage access.
- **Centrifugo** — voice notes and transcript updates travel on the existing `chat:conversation:{id}` channel; no new token surface (auth remains the sole token issuer).
- Tables reference `chat_messages`, `chat_conversations`, and `users`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MINIO_VOICE_NOTES_BUCKET` | Private bucket for voice-note audio | `chat-voice-notes` |
| `VOICE_MAX_DURATION_MS` | Max clip duration; server-observed duration is authoritative | `120000` |
| `VOICE_MAX_SIZE_BYTES` | Max audio object size; server-observed size is authoritative | `5242880` |
| `VOICE_ALLOWED_MIME_TYPES` | Comma-separated allowed audio MIME types | `audio/mp4,audio/aac,audio/mpeg,audio/ogg,audio/webm,audio/wav` |
| `VOICE_UPLOAD_URL_TTL_SECONDS` | Pre-signed PUT (upload) URL TTL | `300` |
| `VOICE_PLAYBACK_URL_TTL_SECONDS` | Pre-signed GET (playback) URL TTL | `300` |
| `VOICE_UPLOAD_GRANT_TTL_SECONDS` | Upload-grant TTL (binds key to conversation+user, single-use) | `600` |
| `VOICE_TRANSCRIPTION_ENABLED` | Enable async transcription; when false notes still send/play (`DISABLED`) | `true` |
| `VOICE_TRANSCRIPTION_TIMEOUT_MS` | HTTP timeout to the AI transcription endpoint | `60000` |
| `VOICE_TRANSCRIPTION_MAX_RETRIES` | Bounded transcription retries (BullMQ attempts + sweep bound) | `3` |
| `VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS` | BullMQ exponential backoff base delay | `5000` |
| `VOICE_AI_SERVICE_URL` | AI/FastAPI base URL for Whisper transcription (required when transcription enabled) | — |
| `VOICE_CLEANUP_INTERVAL_MS` | Orphan grant/object sweep interval | `300000` |
| `VOICE_CLEANUP_BATCH_SIZE` | Cleanup batch size per sweep pass | `100` |
| `VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS` | Re-enqueue a PENDING transcript older than this (no PENDING-forever) | `600000` |
| `VOICE_ORPHAN_RECONCILE_GRACE_MS` | Reconciler ignores bucket objects newer than this | `3600000` |

`validateVoiceNotesConfig()` fails fast on a missing bucket, an empty MIME list, a missing AI URL while transcription is enabled, or any non-positive numeric tunable (skipped under `NODE_ENV=test`).

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/conversations/:id/voice-notes/upload-url` | Participant + OPEN gated. Persists an upload grant, then returns `{ objectKey, uploadUrl, expiresAt }` (single-object pre-signed PUT). The client never chooses the key. |
| POST | `/chat/conversations/:id/messages` (`type: 'VOICE'`) | Sends the durable voice note referencing the uploaded object. Serialized transaction: dedup → OPEN → grant verify → authoritative object inspection → atomic message + metadata + grant-consume → best-effort publish + transcription enqueue. |
| GET | `/chat/conversations/:id/voice-notes/:messageId/playback-url` | Participant gated. Resolves the object key from the DB by message id (never client-supplied) and returns a fresh short-lived pre-signed GET URL. |

## Testing

`__tests__/` covers the storage service (mocked `minio` + WAV probe), the grant/voice-note repositories, `sendVoiceMessage` (grant scoping, fingerprint idempotency, authoritative bounds, atomicity, best-effort publish/enqueue), the Whisper client (mocked axios, bounded retry), the transcription + cleanup processors, an integration flow (upload → send → history → playback, CLOSED race, tombstone), property-based tests (P2/P3, P6/P7, P8/P9, P13, P15) via an in-memory voice DataSource, and a migration-level deletion-coherence spec (P17/P18/P19). The AI `/transcribe` endpoint is tested in `services/ai/tests/test_speech_router.py`.

## Status

Complete. Domain types, configuration + fail-fast validation, entities, migration (`1700000023000-CreateVoiceNoteTables.ts`), the MinIO storage service, the audio duration probe, the grant/voice-note/object-deletion repositories, the `VOICE` send branch + endpoints, the Whisper client, the transcription + cleanup/reconciliation processors, and module wiring are all implemented and tested.

See `.kiro/specs/voice-notes/design.md` for the full design, data model, flows, and correctness properties (P1–P21), and `docs/ADR/012-voice-notes-audio-in-minio-async-transcription.md` for the architecture decision.

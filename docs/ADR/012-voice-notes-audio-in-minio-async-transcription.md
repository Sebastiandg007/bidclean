# ADR-012: Voice Notes — Audio in MinIO (Key-as-Grant), Server-Authoritative Object Inspection, and Asynchronous Best-Effort Transcription

## Status
Accepted

## Context
Spec 14 (`voice-notes`) lets a matched Host↔Cleaner exchange short recorded audio clips inside their
existing chat conversation. It builds directly on `realtime-chat` (Spec 13, ADR-009), which left the
seam open: a `chat_messages` row already carries a `type` discriminator and the write path is already
*persist-then-publish* with PostgreSQL as the source of truth and Centrifugo as best-effort transport.

A voice note is therefore **not a new domain**: it is a `chat_messages` row with `type = 'VOICE'`
(and `body IS NULL`) plus a 1:1 `chat_voice_notes` metadata row. It inherits — unchanged — the
conversation model, participant authorization, `sequence_number` ordering, payload-checked
idempotency, keyset history, CLOSED-rejection, immutability, and Centrifugo transport from Spec 13.

Audio and transcription raise decisions Spec 13 did not need:
- **Where the audio bytes live** and how they move without passing through (or bloating) the API/DB.
- **How a client is authorized** to upload and to play back, given that an object key could be
  guessed, shared, or replayed.
- **What is authoritative** for the size/type/duration limits — the client's declared metadata or
  the actually-stored object.
- **How transcription** is produced without blocking send/playback, without becoming a source of
  truth, and without leaving notes stuck forever if a best-effort enqueue is lost.
- **How orphaned audio** (abandoned uploads, the CLOSED-after-issue race, cascaded deletes) is
  discovered and removed across two distinct systems (PostgreSQL + MinIO) that cannot share a
  transaction.

## Decision
1. **Audio bytes live only in MinIO, never in PostgreSQL and never through the API.** The client
   uploads directly to a short-lived pre-signed PUT URL and plays back via a short-lived
   participant-gated pre-signed GET URL. The database stores only the opaque object key + non-sensitive
   metadata. This reuses the established `PropertyPhotoService` / `minio` pattern.
2. **An object key is a grant, not a credential.** When an upload URL is issued the server generates
   an unguessable key and durably binds it (`voice_note_upload_grants`) to
   `{ conversationId, issued-to user, single-use, expires_at }`. The grant is persisted **before** the
   pre-signed URL is minted. A send is accepted only against a grant that was issued to *this* caller
   for *this* conversation, unexpired and unconsumed; possession of a key authorizes nothing. Playback
   authorizes by conversation participation and resolves the key from the DB by `messageId` — a key is
   never accepted from the client.
3. **The stored object is authoritative; client metadata is advisory.** Inside the serialized send
   transaction the server inspects the actually-stored object (`statObject` for real size/content-type,
   a header-parsing probe for the real duration) and enforces the configured limits against those
   server-observed values. Client-declared duration/size/mime are used only for the idempotency
   fingerprint and as a UX pre-check. An unprobeable object is treated as invalid (400), never as
   "unbounded". The persisted row stores the server-observed values.
4. **The voice send reuses the Spec 13 serialized transaction.** Under the conversation row lock, in
   order: dedup by `client_message_id` against the payload fingerprint
   `{ object_key, duration_ms, size_bytes, mime_type, waveform }` (transcript fields excluded) → OPEN
   check → grant verify → authoritative object inspection → atomic insert of the message + 1:1 metadata
   + grant consumption + `last_message_at` bump. Dedup precedes the OPEN check so an idempotent retry
   still returns the existing message after a close. A grant maps to at most one durable message.
5. **Transcription is asynchronous, best-effort, non-authoritative, and stale-safe (Option A).** After a
   durable send, a BullMQ job is enqueued (only when STT is enabled; otherwise the note's transcript
   status is `DISABLED` and no job runs). The worker fetches the object from MinIO and posts the
   **bytes** to the AI/FastAPI `POST /transcribe` (Whisper.cpp); the AI service is given **no storage
   access**. Each attempt claims a monotonic `transcript_attempt`, and a result is attached only when its
   attempt is the latest, so a slower older attempt can never overwrite a newer one. Success →
   `READY`, terminal failure → `FAILED`; either way the audio stays playable. A **stuck-PENDING sweep**
   re-enqueues a note whose best-effort enqueue was lost (bounded), converging to `READY`/`FAILED` so
   nothing stays `PENDING` forever. The transcript never gates send or playback and is never logged
   verbatim.
6. **Orphan cleanup is eventual, idempotent, and discoverable — never a cross-system DELETE.** A
   `BEFORE DELETE` trigger on `chat_voice_notes` copies the freed `object_key` into a
   `voice_note_object_deletions` tombstone **in the same transaction as the delete** (direct or via
   CASCADE up message → conversation → thread → offer), so the key is captured atomically before it is
   lost. A repeatable cleanup worker then (A) sweeps expired-ISSUED grants + their orphan objects, (B)
   drains tombstones by removing the MinIO object and marking them `DONE`, and (C) runs a reconciler
   backstop over aged, unreferenced bucket objects. The MinIO `removeObject` always happens later in the
   worker, never synchronously inside the DB transaction.
7. **Deletion coherence follows Spec 13.** `chat_voice_notes.message_id` is a UNIQUE FK ON DELETE
   CASCADE (audio metadata dies with its message); the table has no `deleted_at` (audio is immutable).
   Grant `issued_to_user_id`/`consumed_message_id` are `ON DELETE SET NULL`; no new `CASCADE`-from-`users`
   path is introduced, so deleting/anonymizing a participant never destroys shared voice-note history.

## Reasoning
- **Durability + a smaller trust surface.** Keeping audio in MinIO (not the DB, not base64 through the
  API) mirrors how KYC/profile/property media already work, keeps the DB small, and means the audio path
  never blocks or bloats the message path.
- **Key-as-grant closes the obvious attacks.** Binding each key to a single conversation + user +
  single-use + expiry, and persisting the grant before minting the URL, means a leaked/guessed/replayed
  key cannot upload or send, and a URL-minting failure still leaves a sweepable grant.
- **Server-authoritative inspection is the only safe limit.** A manipulated client can declare any
  size/type/duration; validating the actual object is what actually enforces the bounds.
- **Non-blocking transcription preserves the core UX.** Voice must send and play instantly; a Whisper
  outage, disablement, or slow run must never degrade that. Attempt-versioning + the stuck-PENDING sweep
  make the derived transcript converge without ever becoming a gate or a source of truth.
- **Tombstone-then-sweep is the correct two-system pattern.** PostgreSQL and MinIO cannot share a
  transaction, so the trigger captures the key transactionally (rolled back with the delete) and the
  worker does the eventual, idempotent, retryable removal — with a reconciler as defense in depth.

## Alternatives Considered
- **Audio in PostgreSQL / base64 through the API.** Rejected: bloats the DB and the message path,
  and puts bytes on a path that must stay fast and small.
- **Treating the object key as the credential.** Rejected: possession would equal authorization, so a
  leaked/shared key would grant upload or playback; the grant + participation checks are required.
- **Trusting client-declared duration/size/mime.** Rejected: a manipulated client would bypass the
  limits; the stored object is authoritative.
- **Synchronous transcription (block the send) or transcript-as-source-of-truth.** Rejected: couples
  send/playback to Whisper availability and makes a derived convenience authoritative.
- **Option B — passing the AI service a storage reference and letting it read MinIO.** Rejected: it
  would give the AI service storage credentials and split bucket ownership; Option A keeps a single
  storage owner and a smaller trust surface (the worker sends bytes).
- **Synchronous cross-system delete (remove the MinIO object inside the DB transaction).** Rejected:
  the two systems cannot share a transaction; a mid-delete failure would leave inconsistent state. The
  tombstone + eventual sweep is idempotent and crash-safe.
- **A separate voice-note domain / channel / authorization model.** Rejected: a voice note is a chat
  message; reusing Spec 13 wholesale avoids duplicating the conversation, ordering, idempotency, and
  transport contracts.

## Consequences
- Voice notes ship as a thin extension of the chat module: a `VOICE` branch in the serialized send, two
  new endpoints (upload-url, playback-url), three new tables, a MinIO storage service, a Whisper client,
  and BullMQ transcription + cleanup workers — with the text path untouched.
- The AI/FastAPI service gains a `POST /transcribe` endpoint (Whisper.cpp behind a swappable engine, so
  CI/tests inject a stub) and no storage access.
- Everything is testable without real infrastructure: MinIO, Centrifugo, the AI service, and the
  WebSocket are mocked. Correctness is covered by property-based tests (key-as-grant, single-use grant,
  fingerprint idempotency, server-authoritative bounds, transcript stale-safety, interleaved ordering),
  integration/scenario tests (upload → send → history → playback, CLOSED race, tombstone), and a
  migration-level deletion-coherence spec.
- All tunables (limits, TTLs, MIME list, bucket, STT flag/timeouts/retries, AI URL, cleanup/reconcile
  windows) come from configuration; `validateVoiceNotesConfig()` fails fast on missing/invalid required
  values. Audio bytes and transcript text are never written to logs, metrics, or error messages.
- The seam remains open for later specs: message push notifications (Spec 16) attach to the same
  conversation + reconciliation contract; VoIP (Spec 15) is a separate real-time surface.

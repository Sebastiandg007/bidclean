# VoIP Calls Module (API)

## Purpose

Owns in-conversation real-time voice/video calling between a matched Host and Cleaner (spec `voip-calls`, Spec 15). A **call is a conversation event, not a new domain**: a `voip_calls` row is bound to exactly one Spec 13 `chat_conversations` row and inherits — unchanged — the two participants (`hostId`/`cleanerId` via `ChatParticipationService`), the OPEN-lifecycle rule, and the offer-terminal close path. It is not a message and never consumes a `sequence_number`.

This module adds only three things on top of chat, each mirroring an existing seam:

1. **LiveKit as the live-media transport.** Audio/video RTP flows client ↔ LiveKit SFU only; it **never transits the API or PostgreSQL**. Call *control* (invite/accept/decline/cancel/end/busy) is signaled over the **existing** `chat:conversation:{id}` Centrifugo channel — the same persist-then-publish, best-effort transport as chat.
2. **A short-lived, room-scoped LiveKit access token** minted server-side (`LiveKitTokenService`), gated by the chat participation rule **and** a status+role matrix (initiator while `RINGING` via initiate; callee only via `answer`; either participant while `ONGOING`; **no token for any terminal status**). The LiveKit API key/secret live only on the server; only the time-boxed token reaches the client.
3. **A durable, single-winner call state machine** in PostgreSQL (`voip_calls`) plus **server-authoritative liveness** driven by a signed LiveKit webhook and two bounded sweeps (ring-timeout, stale-call) so no call is ever stuck.

**Authority split:** PostgreSQL = source of truth for the call as an event + lifecycle; LiveKit = source of truth for the live media (an ephemeral room referenced only by an opaque `room_name`); Centrifugo = best-effort signaling. A room name is a reference, never a credential.

## Files

| File | Responsibility |
|------|---------------|
| `voip.constants.ts` | Env-configurable values (`LIVEKIT_*`, `VOIP_*`), the non-terminal/terminal status sets, `MediaKind`/`EndReason` constants, `isNonTerminalStatus`/`isTerminalStatus` guards, and `validateVoipConfig()` fail-fast startup validation (skipped under `NODE_ENV=test`). No value hardcoded in logic. |
| `voip.types.ts` | Internal contracts: `CallView`, `MediaToken`, `InitiatedCall`, `InitiateParams`, the `SignalEvent` discriminated union (`call_invite`/`call_ringing`/`call_accept`/`call_decline`/`call_cancel`/`call_end`/`call_busy`), and `VOIP_ERROR_MESSAGES` (structural strings only — never room name / PII / media). |
| `entities/voip-call.entity.ts` | `voip_calls` entity: `@Check` for `status`/`media_kind`/`end_reason`, `@Unique` room, the `(conversation_id, initiated_at)` history index. No `deletedAt` (a terminal call is an immutable audit fact). |
| `voip.repository.ts` | All reads/writes to `voip_calls` via parameterized SQL. The single-winner conditional write (`transitionTerminal`/`answer` → `UPDATE ... WHERE id=:id AND status=:expectedNonTerminal RETURNING ...`); idempotency lookup scoped to `(conversation, initiator, clientCallId)`; `touchMediaActivity(roomName)`; bounded sweep queries (`findRingingOlderThan`/`findStaleOngoing`); `findByRoomName`; keyset history. `duration_seconds` derived once in SQL. |
| `voip.service.ts` | The state machine + authorization gates. `initiate` (serialized transaction: participant → OPEN → dedup → insert RINGING with a generated room; a unique-violation on the active-call index → `409 busy` + minimal `call_busy`; **after commit** mint the initiator token + best-effort `call_invite`); `answer`/`decline`/`cancel`/`end` (single-winner, idempotent no-op when terminal); `mintMediaToken` (status+role gate, room always from the DB); `getCall`/`listCalls`; `forceEndForConversation`. Media/PII never logged. |
| `livekit-room.service.ts` | Opaque `generateRoomName()` (`call-<uuid>`, never reused) + idempotent best-effort `deleteRoomSafe()`. Wraps the LiveKit server SDK room-admin API only; it does **not** sign access tokens. |
| `livekit-token.service.ts` | Mints the short-lived, room-scoped LiveKit access token (audio always; camera only when `media_kind = VIDEO` **and** video enabled); never grants room-create/list/admin. Reads `LIVEKIT_API_KEY`/`SECRET` from config; the secret never leaves the server. |
| `voip.controller.ts` | JWT-guarded REST surface under `/chat/conversations/:id/calls`. Resolves the authenticated Keycloak subject to a BidClean user; delegates to `VoipService`. |
| `dto/initiate-call.dto.ts` / `dto/end-call.dto.ts` | Validated payloads (`clientCallId` + `mediaKind`; an optional `endReason` that may only be `HANGUP` — the server derives the authoritative terminal cause). |
| `livekit-webhook.controller.ts` | `POST /webhooks/livekit` (public, NOT JWT). Authenticates the LiveKit signature over the **preserved raw body** (the Stripe/RevenueCat pattern), idempotent. `participant_joined`/`participant_left`/`room_started` → `touchMediaActivity`; `room_finished` is a **liveness signal, not a verdict** (benign empty close of a still-ONGOING call → single-winner `ENDED`/`HANGUP`; explicit error → `FAILED`/`ERROR`; ambiguous → deferred to the stale sweep as `ENDED`/`TIMEOUT` — never a blind generic `ENDED`). Bad signature → 401, no mutation; unknown room/duplicate → idempotent 200. |
| `voip-sweep.processor.ts` | BullMQ repeatable worker (interval/batch from config). (A) ring-timeout — aged `RINGING` → single-winner `MISSED`/`TIMEOUT_NO_ANSWER`; (B) stale-call — `ONGOING` with stale `last_media_activity_at` (or past max duration) → single-winner `ENDED`/`TIMEOUT`. Both best-effort publish `call_end`; a per-item failure never stalls the batch. An ordinary timeout is never `FAILED`/`ERROR`. |
| `offer-terminal-call.listener.ts` | Decoupled `@OnEvent` listener mirroring `OfferTerminalChatListener`: on offer CANCELLED/EXPIRED/COMPLETED, `forceEndForConversation(convId, CONVERSATION_CLOSED)` idempotently over each of the offer's conversations (resolved via `ChatRepository.findConversationIdsForOffer`). Best-effort — a failure is logged, never propagated (the stale sweep is the backstop). |

## Dependencies

- **LiveKit (self-hosted SFU)** — the live-media transport. `livekit-server-sdk` for room admin (`RoomServiceClient`), token minting (`AccessToken`), and webhook verification (`WebhookReceiver`); `@livekit/protocol` for `RoomEndReason`. Credentials (`LIVEKIT_API_KEY`/`SECRET`) live only in server config.
- **Centrifugo** — reuses the existing `CentrifugoClient` (bound to the `CHAT_REALTIME_PUBLISHER` seam via `OffersModule`) to publish call-control events on the **existing** `chat:conversation:{id}` channel. No new channel or token surface.
- **Chat module** — reuses `ChatConversation` (participants + OPEN-lifecycle), `ChatParticipationService`, `ChatRepository.findConversationIdsForOffer`, and `chatChannelForConversation`.
- **Offers module** — the offer-terminal domain events drive the force-end listener.
- **Redis / BullMQ** — the repeatable sweep queue (`VOIP_SWEEP_QUEUE_NAME`), registered in `chat.module.ts`.
- Table (migration `1700000040000-CreateVoipCallsTable`): `voip_calls`; references `chat_conversations`, `offers`, `users`.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/conversations/:id/calls` | Initiate a call (idempotent by `clientCallId`); returns `{ call, roomName, media }` |
| POST | `/chat/conversations/:id/calls/:callId/answer` | Answer as the callee; returns the callee's media token; `RINGING → ONGOING` |
| POST | `/chat/conversations/:id/calls/:callId/decline` | Decline as the callee; `RINGING → DECLINED` |
| POST | `/chat/conversations/:id/calls/:callId/cancel` | Cancel as the initiator before answer; `RINGING → CANCELED` |
| POST | `/chat/conversations/:id/calls/:callId/end` | Hang up; single-winner terminal (`ONGOING → ENDED`/`HANGUP`) |
| POST | `/chat/conversations/:id/calls/:callId/token` | Mint a media token per the status+role gate (rejoin path) |
| GET | `/chat/conversations/:id/calls/:callId` | Authoritative call state (reconciliation) |
| GET | `/chat/conversations/:id/calls?before=<iso>&limit=N` | Call history (missed-call UX) |
| POST | `/webhooks/livekit` | Signed, idempotent LiveKit liveness webhook (public, NOT JWT) |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `LIVEKIT_URL` | LiveKit server URL (media endpoint; returned inside the minted token) | Yes |
| `LIVEKIT_API_KEY` | LiveKit API key — signs access tokens (server-only) | Yes |
| `LIVEKIT_API_SECRET` | LiveKit API secret — signs access tokens (server-only) | Yes |
| `LIVEKIT_WEBHOOK_API_KEY` / `LIVEKIT_WEBHOOK_API_SECRET` | Dedicated webhook key pair; falls back to the main API pair when unset | No |
| `VOIP_MEDIA_TOKEN_TTL_SECONDS` | Media token TTL (short-lived) | No (default 300) |
| `VOIP_RING_TIMEOUT_MS` | Unanswered-ring window → MISSED | No (default 45000) |
| `VOIP_STALE_CALL_TIMEOUT_MS` | Stale-media window for an ONGOING call → ENDED/TIMEOUT | No (default 90000) |
| `VOIP_MAX_CALL_DURATION_MS` | Coarse max-duration backstop | No (default 14400000) |
| `VOIP_VIDEO_ENABLED` | Whether video is enabled (else degrade to audio) | No (default true) |
| `VOIP_SWEEP_INTERVAL_MS` / `VOIP_SWEEP_BATCH_SIZE` | Sweep tuning | No |

`validateVoipConfig()` fails fast on a missing LiveKit URL/key/secret or a non-positive numeric tunable (skipped under `NODE_ENV=test`).

## Push integration seam (Spec 16)

`voip-calls` does **not** implement push delivery. When a call reaches `RINGING`, `VoipService.initiate` marks the single trigger point with a `TODO(orchestrator): emit voip_outbox call-invited here — push Task 12` comment, right after the durable RINGING row commits. The execution orchestrator wires push into that point; this module never writes the outbox.

## Testing

| Suite | Covers |
|-------|--------|
| `__tests__/voip.service.spec.ts` | participant/OPEN gates (403/409); idempotent dedup; single-winner end; the status+role token matrix (callee blocked while RINGING except via answer; terminal → no token; room always from DB); best-effort publish failure non-blocking. |
| `__tests__/voip.repository.spec.ts` | single-winner terminal write (rows=1 winner / rows=0 loser, duration derived once); `answer` only from RINGING; idempotency scope; sweep queries select only aged rows; parameterized SQL. |
| `__tests__/livekit-room-token.spec.ts` | room name unguessable + unique; `deleteRoomSafe` idempotent/best-effort; token TTL/scope (one room + one identity), video grant only when enabled, no admin caps. |
| `__tests__/livekit-webhook.controller.spec.ts` | valid/invalid signature (401, no mutation); activity bump on join/leave; `room_finished` cause interpretation (ENDED/HANGUP vs FAILED/ERROR vs defer-to-sweep); unknown room no-op. |
| `__tests__/voip-sweep.processor.spec.ts` | ring sweep only aged RINGING → MISSED; stale sweep only aged/over-max ONGOING → ENDED/TIMEOUT; both single-winner + idempotent; publish failure non-blocking. |
| `__tests__/voip-deletion-coherence.spec.ts` | DDL asserts `initiator_id`/`callee_id` are `ON DELETE SET NULL` and `conversation_id`/`offer_id` CASCADE (no user-cascade); idempotency index scoped to `(conversation, initiator, clientCallId) WHERE initiator_id IS NOT NULL`. |

## Correctness Properties

P1 call is a conversation event · P2 participant isolation · P3 room/callId is a reference not a credential · P4 status+role token gate · P5 media isolation · P6 durable-first initiation · P7 idempotent initiation · P8 one active call (DB-enforced) · P9 monotonic state machine · P10 single-winner terminal transition · P11 no stuck ring · P12 no stuck ONGOING (server-authoritative liveness) · P13 `room_finished` is a signal not a verdict · P14 duration consistency · P15 signaling idempotency / reconciliation / one-call-per-session · P16 deletion coherence & no hardcoded config.

See `.kiro/specs/voip-calls/design.md` for the full design and property definitions.

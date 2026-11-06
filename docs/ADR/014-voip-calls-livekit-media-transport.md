# ADR-014: VoIP Calls — LiveKit Media Transport, Centrifugo Signaling, Webhook-Driven Liveness

## Status
Accepted

## Context
BidClean needs in-conversation real-time voice (and optional video) calling between a matched Host and Cleaner (Spec 15, `voip-calls`). The existing chat (Spec 13) already owns the conversation, the two-participant authorization, the OPEN-lifecycle rule, and a best-effort Centrifugo transport. A call must not become a second authorization or conversation model, media must never touch the API or database, and no call may be left stuck "ringing" or "ongoing" forever. Media transport (an SFU) had no implementation in the codebase yet.

## Decision
A call is a `voip_calls` row bound to one `chat_conversations` row — not a new domain. On top of chat we add exactly three things:

1. **LiveKit (self-hosted SFU) as the live-media transport.** Audio/video RTP flows client ↔ SFU only. The API and PostgreSQL are never in the media path; the database stores only an opaque `room_name` plus lifecycle facts.
2. **Call control signaled over the existing `chat:conversation:{id}` Centrifugo channel.** Invite/ringing/accept/decline/cancel/end/busy are best-effort control events on the channel the two participants already subscribe to — the same persist-then-publish model as chat. No new channel, no new token surface.
3. **A durable, single-winner state machine in PostgreSQL with server-authoritative liveness.** Every terminal transition is a conditional write (`UPDATE ... WHERE id=:id AND status=:expectedNonTerminal`), so exactly one of N concurrent actors wins. Liveness comes from a **signed LiveKit webhook** (never a client heartbeat) plus two bounded sweeps (ring-timeout, stale-call).

## Reasoning
- **Authority split kept strict.** PostgreSQL is the source of truth for *that a call happened* and its lifecycle; LiveKit is the source of truth for the live media session; Centrifugo is best-effort signaling reconciled via `GET`. A dropped signaling frame never corrupts call state.
- **Room name / callId is a reference, not a credential.** Joining media requires a short-lived, room-scoped, identity-scoped LiveKit access token minted server-side, issued only per a status+role matrix (initiator while `RINGING` via initiate; callee only via `answer`; either participant while `ONGOING`; no token for any terminal status). Possession of a room name authorizes nothing — the same possession-proof stance as pre-signed URLs in voice-notes.
- **Token minting mirrors the Centrifugo-token ownership boundary.** The LiveKit API key/secret live only in server config; only the time-boxed token reaches the client. Video is granted only when `media_kind = VIDEO` and video is enabled.
- **Server-authoritative liveness avoids a trust-the-client heartbeat.** `last_media_activity_at` is driven only by the signed webhook. `room_finished` is interpreted by cause (benign empty close → `ENDED`/`HANGUP`; explicit error → `FAILED`/`ERROR`; ambiguous → deferred to the stale sweep as `ENDED`/`TIMEOUT`) — never a blind generic `ENDED`.
- **DB-enforced single active call.** A partial unique index over non-terminal `status` guarantees at most one active call per conversation; a concurrent second initiate becomes `409 busy`.

## Signaling & Media Flow
1. Initiator POSTs `initiate` → serialized transaction (participant + OPEN + no-active-call + dedup + insert `RINGING` + generate `room_name`) commits **before** any token or signal → mint initiator token → best-effort `call_invite`.
2. Callee POSTs `answer` → single-winner `RINGING → ONGOING` → mint callee token → best-effort `call_accept`. Both join the LiveKit room; media flows client ↔ SFU.
3. LiveKit emits `participant_joined`/`participant_left` webhooks → `last_media_activity_at` bumped.
4. Either party POSTs `end` → single-winner `ONGOING → ENDED`/`HANGUP`, duration derived once → best-effort `call_end`. Sweeps resolve any call left ringing (→ `MISSED`) or stale (→ `ENDED`/`TIMEOUT`).

## Alternatives Considered
- **Peer-to-peer WebRTC (no SFU).** Simpler for 1:1 but no server-side liveness, poor NAT traversal without TURN, and no clean path to video/scale. Rejected.
- **A dedicated call domain + new channel + new token surface.** Duplicates the chat authorization and conversation model for no benefit; a call is already scoped to exactly the conversation's two participants. Rejected.
- **A managed cloud calling provider (Twilio/Agora).** Recurring per-minute cost, another external dependency, and less control; conflicts with the self-hosted plan. Rejected in favor of self-hosted LiveKit.
- **Client heartbeat for liveness.** Trusts the client and races with backgrounding; a signed server webhook is authoritative. Rejected.

## Consequences
- A new external transport (LiveKit) must be operated self-hosted (rooms auto-close on empty + `empty_timeout`; no synchronous room-delete is required for correctness).
- The mobile client needs the LiveKit native SDK (`@livekit/react-native` + `@livekit/react-native-webrtc`), which requires a prebuild/EAS build — unit tests mock it.
- Push delivery / OS call integration (CallKit / ConnectionService) to wake a backgrounded or killed app is **out of scope** here and owned by `push-notifications` (Spec 16); this spec only exposes the events push will carry, marked by a single `voip_outbox` trigger point at `RINGING`.
- Call recording/transcription and live-call translation are out of scope (recording is Spec 18).
- A terminal call record is an immutable audit fact (no `deleted_at`); `initiator_id`/`callee_id` are `ON DELETE SET NULL` so deleting a participant never destroys shared call history.

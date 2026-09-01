# Chat Module (API)

## Purpose

Owns post-match Host↔Cleaner messaging (spec `realtime-chat`). A conversation is attached to a **matched `negotiation_thread`** (a thread with an `ACCEPTED` proposal) and copies its `hostId`, `cleanerId`, and `offerId`; those two users are the only participants and the sole authorization basis for both REST and Centrifugo subscription. PostgreSQL is the source of truth — messages are persisted first and published to Centrifugo second (transport only), mirroring the offers pipeline. A conversation stays `OPEN` only while its match remains valid (thread not CLOSED and offer not terminal).

This module does not issue Centrifugo tokens. Auth owns identity and token signing (`GET /auth/centrifugo/token`); chat owns the participation rule and is consulted (via `ChatParticipationService`) before a per-channel subscription token is minted.

## Files

| File | Responsibility |
|------|---------------|
| `chat.constants.ts` | Env-configurable values (token TTL, message length, page size, channel prefix) + `chatChannelForConversation()` helper + `validateChatConfig()` fail-fast startup validation. Reuses the shared `CENTRIFUGO_*` variables rather than introducing divergent ones. |

> The remaining components (`chat.module.ts`, `chat.controller.ts`, `chat.service.ts`, `chat-participation.service.ts`, `chat.repository.ts`, entities, DTOs) are landing incrementally per the `realtime-chat` spec tasks. Update this table as each file is added.

## Dependencies

- **Centrifugo** — WebSocket transport for live message delivery; reuses the existing `CentrifugoClient` (shared `CENTRIFUGO_API_URL` / `CENTRIFUGO_API_KEY` / `CENTRIFUGO_TOKEN_SECRET`).
- **Auth module** — consumes `ChatParticipationService.isParticipant()` to gate per-channel subscription tokens; chat never issues tokens itself.
- **Negotiation module** — match lookup (`ACCEPTED` proposal on a thread) gates conversation creation; thread/offer terminal transitions close the conversation.
- Tables (planned, migration `1700000019000-CreateChatTables`): `chat_conversations`, `chat_messages`; references `negotiation_threads`, `offers`, `users`.

## API (planned per spec)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/threads/:threadId/conversation` | Open-or-get the conversation for a matched thread (idempotent) |
| GET | `/chat/conversations` | Caller's conversations (inbox), `last_message_at` desc |
| GET | `/chat/conversations/:id` | Single conversation (participant-only) |
| GET | `/chat/conversations/:id/messages?before=<seq>&limit=N` | Older history (backward scroll) |
| GET | `/chat/conversations/:id/messages?after=<seq>&limit=N` | Newer messages (reconnect reconciliation) |
| POST | `/chat/conversations/:id/messages` | Send a message (requires `Idempotency-Key`) |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CENTRIFUGO_TOKEN_SECRET` | HMAC-SHA256 secret for signing connection + subscription tokens (shared; required in production) | — |
| `CENTRIFUGO_API_URL` | Centrifugo HTTP API base URL (shared; publish transport) | — |
| `CENTRIFUGO_API_KEY` | Centrifugo HTTP API key (shared; publish transport) | — |
| `CHAT_CONNECTION_TOKEN_TTL_SECONDS` | Connection/subscription token lifetime (seconds) | `3600` |
| `CHAT_MESSAGE_MAX_LENGTH` | Max message body length (chars); longer bodies rejected with 400 | `4000` |
| `CHAT_HISTORY_PAGE_SIZE` | Default keyset history page size (before/after cursors) | `50` |
| `CHAT_CHANNEL_PREFIX` | Channel namespace prefix for `chat:conversation:{id}` | `chat:conversation:` |

`validateChatConfig()` fails fast on a missing token secret or non-positive numeric tunables (skipped under `NODE_ENV=test`, consistent with the other modules).

## Correctness Properties

P1 conversation lifecycle follows match validity · P2 one conversation per thread · P3 participant-only access · P4 durable before realtime · P5 idempotent send (payload-checked) · P6 total order (gaps allowed) · P7 validated content, no verbatim logging · P8/P9 keyset history authoritative · P10/P11 token scoping, integrity & expiry · P12 fail-fast config · P16 atomic summary · P17 race-free close · P18 no cascade-from-users.

See `.kiro/specs/realtime-chat/design.md` for the full design and property definitions.

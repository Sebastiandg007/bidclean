# Chat Module (API)

## Purpose

Owns post-match Host↔Cleaner messaging (spec `realtime-chat`). A conversation is attached to a **matched `negotiation_thread`** (a thread with an `ACCEPTED` proposal) and copies its `hostId`, `cleanerId`, and `offerId`; those two users are the only participants and the sole authorization basis for both REST and Centrifugo subscription. PostgreSQL is the source of truth — messages are persisted first and published to Centrifugo second (transport only), mirroring the offers pipeline. A conversation stays `OPEN` only while its match remains valid (thread not CLOSED and offer not terminal).

This module does not issue Centrifugo tokens. Auth owns identity and token signing (`GET /auth/centrifugo/token`); chat owns the participation rule and is consulted (via `ChatParticipationService`) before a per-channel subscription token is minted.

## Files

| File | Responsibility |
|------|---------------|
| `chat.constants.ts` | Env-configurable values (token TTL, message length, page size, channel prefix) + `chatChannelForConversation()` helper + `validateChatConfig()` fail-fast startup validation. Reuses the shared `CENTRIFUGO_*` variables rather than introducing divergent ones. |
| `chat.types.ts` | API-facing view/result contracts: `ConversationStatus` / `MessageType` unions, `MessageView`, `ConversationView`, `ConversationSummaryView` (inbox row), `SendResult` (with `deduplicated`), and `MessagePage` (keyset history page). Message bodies are plain user text, never logged verbatim. |
| `entities/chat-conversation.entity.ts` | `chat_conversations` table entity (conversation attached to a matched thread). |
| `entities/chat-message.entity.ts` | `chat_messages` table entity (ordered, idempotent messages). |
| `chat.repository.ts` | All reads/writes to `chat_conversations` / `chat_messages` via parameterized SQL. Idempotent open-or-get per thread (P2); serialized send under the conversation row lock — verify `OPEN`, dedup on `(conversation_id, client_message_id)` with payload check, allocate `sequence_number` from the locked `message_seq` counter, insert, and bump `last_message_at` atomically (P4/P5/P6/P16/P17); keyset history via `getMessagesBefore`/`getMessagesAfter` (P8/P9); inbox via `listConversationsForUser`; `isParticipant` check (P3); idempotent `closeConversationForThread` (P1). |
| `chat-participation.service.ts` | Single source of the chat participation rule (`isParticipant(userId, conversationId)`, delegating to `ChatRepository`). Consumed by chat's own authorization and by the auth module's Centrifugo subscription-token endpoint (auth owns token issuance, chat owns participation). Identity is always the authenticated subject supplied by the caller, never a client-supplied value or channel string (P3). |
| `chat.service.ts` | Orchestrates the chat domain. Opening a conversation requires the thread to be MATCHED (an ACCEPTED proposal for that exact thread, via `NegotiationRepository.isThreadMatched`, P1/P2); reads/writes require the caller to be a participant (P3). Send validates the body (P7), delegates to the repository's serialized transaction (durable before realtime, P4), then publishes best-effort to Centrifugo through the injected `ChatRealtimePublisher` seam — a publish failure never fails the request nor loses the message (P4). Message bodies are never logged verbatim (P7). |
| `chat.controller.ts` | JWT-guarded REST surface (`/chat`). Resolves the authenticated Keycloak subject to a BidClean user and passes that server-side identity to the service (never a client-supplied id, P3). Exposes open-or-get conversation, inbox list, single conversation, keyset history (`before`/`after` cursors, page size bounded by `CHAT_HISTORY_PAGE_SIZE`), and send (requires an `Idempotency-Key` header + `clientMessageId`, P5). |
| `dto/send-message.dto.ts` | Validated send payload (`clientMessageId`, `body`), enforced with a whitelisting `ValidationPipe`. |
| `chat.module.ts` | Wires the module: registers `ChatController` + providers, binds the `CHAT_REALTIME_PUBLISHER` seam to the existing `CentrifugoClient` (`useExisting`, imported via `OffersModule`) so the service depends on the interface not the HTTP client, and exports `ChatParticipationService` (for the auth Centrifugo endpoint) and `ChatService`. Runs `validateChatConfig()` on init (fail-fast). |

## Dependencies

- **Centrifugo** — WebSocket transport for live message delivery; reuses the existing `CentrifugoClient` (shared `CENTRIFUGO_API_URL` / `CENTRIFUGO_API_KEY` / `CENTRIFUGO_TOKEN_SECRET`).
- **Auth module** — consumes `ChatParticipationService.isParticipant()` to gate per-channel subscription tokens; chat never issues tokens itself.
- **Negotiation module** — match lookup (`ACCEPTED` proposal on a thread) gates conversation creation; thread/offer terminal transitions close the conversation.
- Tables (planned, migration `1700000019000-CreateChatTables`): `chat_conversations`, `chat_messages`; references `negotiation_threads`, `offers`, `users`.

## API

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

## Testing

| Suite | Covers |
|-------|--------|
| `__tests__/chat.service.spec.ts` | `ChatService` orchestration with mocked repositories + publisher: open gated on a per-thread match (P1) and participant-only (P3); send validates the body (P7), persists before publishing (P4), treats an idempotent duplicate as no-publish and maps payload-mismatch/closed/not-found outcomes to the right HTTP errors (P5), and never throws when the Centrifugo publish fails (best-effort transport, P4). |
| `__tests__/chat.integration.spec.ts` | `ChatService` wired to the real `ChatRepository` over an in-memory `DataSource` (match lookup mocked, controllable publisher): match → open → send → read-back through keyset history end-to-end (P1/P4/P9), plus participant and lifecycle guards (P3/P17). |
| `__tests__/chat.repository.spec.ts` | `ChatRepository` reads/writes against the in-memory `DataSource`: idempotent open-or-get (P2), serialized send with dedup + sequence allocation (P5/P6), history cursors (P8/P9), and idempotent close (P1). |

## Correctness Properties

P1 conversation lifecycle follows match validity · P2 one conversation per thread · P3 participant-only access · P4 durable before realtime · P5 idempotent send (payload-checked) · P6 total order (gaps allowed) · P7 validated content, no verbatim logging · P8/P9 keyset history authoritative · P10/P11 token scoping, integrity & expiry · P12 fail-fast config · P16 atomic summary · P17 race-free close · P18 no cascade-from-users.

See `.kiro/specs/realtime-chat/design.md` for the full design and property definitions.

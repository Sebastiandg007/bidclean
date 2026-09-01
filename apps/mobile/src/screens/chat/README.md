# Chat Screens

## Purpose

Post-match, one-to-one messaging between a Host and a Cleaner. A conversation exists only for a **matched** negotiation thread (a thread with an `ACCEPTED` proposal) and stays `OPEN` while that match remains valid. The mobile feature renders the conversation, sends messages optimistically, and stays live over a Centrifugo WebSocket, reconciling missed messages from server history on reconnect. PostgreSQL is the source of truth; realtime is transport only.

See the backend module (`services/api/src/chat/`) and the spec (`.kiro/specs/realtime-chat/`) for the full contract and correctness properties.

## Flow

```
Match (thread ACCEPTED)
  → open-or-get conversation for threadId (idempotent)
  → ChatScreen (history via keyset paging + live messages)
  → send (optimistic, keyed by clientMessageId) → server-confirmed
```

Reachable from both role navigators: the Host Offers stack (from a matched offer detail) and the Cleaner `Active` tab.

## Files

| File | Responsibility |
|------|---------------|
| `chat.types.ts` | Mobile domain contracts: `ChatConversation`, `ChatConversationSummary`, `ChatMessage` (+ local `sendState`), `ChatSendResult`, `ChatMessagePage`, `ChatMessageEvent`, and the `ConversationStatus` / `MessageType` / `SendState` / `ConnectionStatus` unions |
| `chat.constants.ts` | Routes/endpoints, channel prefix, message max length, page size, send timeout (all from `EXPO_PUBLIC_*` / constants), i18n keys |
| `chat.api.ts` | Typed calls over the shared `apiClient` (open-or-get, list, get, history `before`/`after`, send, get connection/subscription token) |
| `chat.store.ts` | Zustand `useChatStore` (conversations, messagesByConversation, connectionStatus) with optimistic send keyed by `clientMessageId`, timeout → `failed`, and upsert/dedup by `id` (and `clientMessageId` for own sends) in `sequenceNumber` order |

### Planned (per `realtime-chat/design.md`)

| File | Responsibility |
|------|---------------|
| `useChatChannel.ts` | WebSocket lifecycle mirroring `useCentrifugoChannel` (token fetch, connect to `chat:conversation:{id}`, push-envelope unwrap, bounded-backoff reconnect, foreground reconcile via `after`, teardown) |
| `ChatScreen.tsx` | Conversation screen (own vs counterparty bubbles, send-state affordance, i18n) |
| `components/MessageBubble.tsx` | Single message bubble (own vs counterparty, send state) |
| `components/MessageComposer.tsx` | Text input + send action (validates against message max length) |
| `components/ConversationHeader.tsx` | Counterparty header for the active conversation |

## Tests

| File | Responsibility |
|------|---------------|
| `__tests__/chat.store.spec.ts` | Unit + property-based tests for `chat.store.ts`: optimistic send reconciliation, send-timeout → `failed`, late confirmation after timeout, dedup by `id` and `clientMessageId`, `sequenceNumber` ordering, `loadOlder`/`reconcileNewer` paging merges, `reset`, and property P13 (each message rendered once, in order, under arbitrary interleavings). `chat.api` and `expo-crypto` are mocked; no network or native crypto |

## Dependencies

- `apps/mobile/src/screens/negotiation` — a conversation opens only for a matched thread; the thread/offer id is the entry point
- Shared `apiClient` (`src/services/`) — REST calls (open-or-get, history, send, token)
- Centrifugo WebSocket — live message delivery over `chat:conversation:{id}`
- Auth — the `GET /auth/centrifugo/token` endpoint issues connection and per-conversation subscription tokens (participant-gated server-side)
- `zustand` — feature store (one store per domain)
- `react-native-reanimated`, `react-native-safe-area-context` — UI

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/threads/:threadId/conversation` | Open-or-get the conversation for a matched thread (idempotent) |
| GET | `/chat/conversations` | Caller's conversations (inbox), `last_message_at` desc |
| GET | `/chat/conversations/:id` | Single conversation (participant-only) |
| GET | `/chat/conversations/:id/messages?before=<seq>&limit=N` | Older history (backward scroll) |
| GET | `/chat/conversations/:id/messages?after=<seq>&limit=N` | Newer messages (reconnect reconciliation) |
| POST | `/chat/conversations/:id/messages` | Send (requires `Idempotency-Key` header + `clientMessageId`) |
| GET | `/auth/centrifugo/token` | Connection token; `?channel=chat:conversation:{id}` mints a participant-gated subscription token |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EXPO_PUBLIC_CENTRIFUGO_WS_URL` | Centrifugo WebSocket URL | Yes |
| `EXPO_PUBLIC_CENTRIFUGO_TOKEN_URL` | Token endpoint (defaults to `/auth/centrifugo/token`) | Yes |
| `EXPO_PUBLIC_CHAT_MESSAGE_MAX_LENGTH` | Max message body length (client validation) | No (constant fallback) |
| `EXPO_PUBLIC_CHAT_HISTORY_PAGE_SIZE` | History page size for keyset paging | No (constant fallback) |
| `EXPO_PUBLIC_CHAT_SEND_TIMEOUT_MS` | Optimistic-send timeout before marking `failed` | No (constant fallback) |

## Design System

Uses the BidClean design system tokens (see `src/theme/`):
- Dark mode background, container surfaces, accent color for the send action
- Own vs counterparty message distinction
- All UI text uses i18n keys (prefix: `chat.*`)

## Message Model Notes

- Messages are ordered by `sequenceNumber` (server-authoritative, unique + strictly increasing per conversation; gaps allowed).
- De-duplicated by `id` (server) and `clientMessageId` (own optimistic sends), so an event processed twice never renders twice.
- `sendState` (`sending` | `sent` | `failed`) is local-only and never persisted server-side; it reconciles to the server-confirmed message on success.
- Text-only in v1 (`type` discriminator reserved for future message types); no edit/delete, no read receipts, no durable offline outbox — a `failed` send is retried with the same `clientMessageId`.

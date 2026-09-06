# Chat Screens

## Purpose

Post-match, one-to-one messaging between a Host and a Cleaner. A conversation exists only for a **matched** negotiation thread (a thread with an `ACCEPTED` proposal) and stays `OPEN` while that match remains valid. The mobile feature renders the conversation, sends messages optimistically, and stays live over a Centrifugo WebSocket, reconciling missed messages from server history on reconnect. PostgreSQL is the source of truth; realtime is transport only.

**Voice notes (Spec 14)** extend this surface: the composer gains a record/preview/send affordance and each `type: 'VOICE'` message renders a `VoiceNotePlayer`. Audio uploads directly to MinIO via a short-lived pre-signed URL (never through the API); an asynchronous, best-effort transcript is attached later and shown when available — never blocking playback.

See the backend module (`services/api/src/chat/`, and `services/api/src/chat/voice/` for voice notes) and the specs (`.kiro/specs/realtime-chat/`, `.kiro/specs/voice-notes/`) for the full contract and correctness properties.

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
| `useChatChannel.ts` | WebSocket lifecycle mirroring `useCentrifugoChannel` (raw WebSocket): fetches connection + per-channel subscription tokens, connects to `chat:conversation:{id}`, unwraps the Centrifugo push envelope, reconnects with bounded exponential backoff, reconciles missed messages via the `after` cursor on every (re)connect, and tears down on unmount. Transport only — merge/dedup/order live in the store |
| `components/MessageBubble.tsx` | Single message bubble (own vs counterparty, send state) |
| `components/MessageComposer.tsx` | Text input + send action, plus the voice-note record/preview/send affordance (Spec 14); validates against the client-side message max length + max-duration UX pre-check; backend authoritative |
| `components/VoiceNotePlayer.tsx` | Voice notes (Spec 14): play/pause, duration, waveform, transcript by status (`READY`/`PENDING`/`FAILED`/`DISABLED`) — never blocks playback; own uses the local audio uri, counterparty fetches a fresh pre-signed playback URL on demand |
| `useVoiceRecorder.ts` | Voice notes (Spec 14): `expo-av` recording lifecycle — start/stop with elapsed time, max-duration UX auto-stop, preview/discard, graceful mic-permission fallback (never crashes/blocks text) |
| `voice.api.ts` | Voice notes (Spec 14): composed upload-url → direct MinIO PUT → send-message action, plus `requestPlaybackUrl` |
| `ChatEntryScreen.tsx` | Navigation container: resolves a matched `threadId` into a conversation via the store's idempotent open-or-get, showing a loading indicator while resolving and an error state on failure, then mounts `ChatScreen` with the resolved `conversationId`. Keeps the resolve step out of `ChatScreen` so it stays focused on a known conversation; all copy from i18n |
| `ChatScreen.tsx` | Conversation screen: composes the store (state + optimistic send) with `useChatChannel` (incoming + reconcile) and the presentational components (header, message list, composer); own vs counterparty decided by the authenticated user id; renders the empty/closed states; all copy from i18n |
| `components/ConversationHeader.tsx` | Top bar for the active conversation: back affordance, title, and a connection-status indicator (connected / connecting / reconnecting / offline); i18n copy only, no message content |

## Tests

| File | Responsibility |
|------|---------------|
| `__tests__/chat.store.spec.ts` | Unit + property-based tests for `chat.store.ts`: optimistic send reconciliation, send-timeout → `failed`, late confirmation after timeout, dedup by `id` and `clientMessageId`, `sequenceNumber` ordering, `loadOlder`/`reconcileNewer` paging merges, `reset`, and property P13 (each message rendered once, in order, under arbitrary interleavings). `chat.api` and `expo-crypto` are mocked; no network or native crypto |
| `__tests__/ChatScreen.spec.tsx` | Unit tests for `ChatScreen`: renders own vs counterparty messages (alignment via `isOwn`), surfaces the send-state affordance for own optimistic messages, hides the composer and shows the closed notice when the conversation is `CLOSED`, and renders the empty state. i18n returns keys/defaults; `useChatChannel` and `chat.api` are mocked (no WebSocket/network) |
| `__tests__/useChatChannel.spec.ts` | Unit tests for the `useChatChannel` realtime lifecycle: token fetch, subscribe on mount, envelope unwrap → `onMessage`, reconcile-on-(re)connect, bounded backoff, and teardown on unmount |
| `__tests__/voice.store.spec.ts` | Voice notes (Spec 14): optimistic VOICE send + timeout→failed, and `applyTranscriptUpdate` upsert-by-id ignoring an older attempt (property P14, fast-check) |
| `__tests__/useVoiceRecorder.spec.ts` | Voice notes (Spec 14): mic-denied graceful fallback, record→stop produces a clip, discard returns to idle (`expo-av` mocked) |
| `__tests__/voice.api.spec.ts` | Voice notes (Spec 14): the composed upload-url → PUT → send flow + `requestPlaybackUrl` (apiClient + `fetch` mocked) |
| `__tests__/VoiceNotePlayer.spec.tsx` | Voice notes (Spec 14): each transcript state renders without blocking playback, playback URL fetched on demand (own uses local uri), duration + waveform for both sides (P16) |

## Dependencies

- `apps/mobile/src/screens/negotiation` — a conversation opens only for a matched thread; the thread/offer id is the entry point
- Shared `apiClient` (`src/services/`) — REST calls (open-or-get, history, send, token, voice upload-url/playback-url)
- Centrifugo WebSocket — live message delivery over `chat:conversation:{id}` (chat messages + `voice_transcript_updated` events)
- MinIO — voice-note audio uploaded/played back directly via short-lived pre-signed URLs (Spec 14)
- Auth — the `GET /auth/centrifugo/token` endpoint issues connection and per-conversation subscription tokens (participant-gated server-side)
- `zustand` — feature store (one store per domain)
- `expo-av` — voice-note recording + playback (Spec 14)
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

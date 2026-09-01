# Implementation Plan: Realtime Chat

## Overview

`realtime-chat` adds post-match Host↔Cleaner messaging. It is full-stack but thin, built on existing seams: the backend reuses the `CentrifugoClient` (publish) and the `JwtAuthGuard`, attaches a conversation to a matched `negotiation_thread`, and persists to PostgreSQL first (source of truth) then publishes to Centrifugo (transport). The single missing infra piece — the `GET /auth/centrifugo/token` endpoint the mobile client already calls — is introduced here, owned by the **auth** module and signing with the currently-unused `CENTRIFUGO_TOKEN_SECRET`; the **chat** module owns only the participation rule the token endpoint consults. The mobile side mirrors the existing `useCentrifugoChannel` lifecycle in a new `useChatChannel` (no new dependency).

Implementation is bottom-up: config/constants + migration + entities first, then the chat repository (serialized send transaction), then the participation service + token service + token endpoint, then the chat service and controller, then match-invalidation lifecycle wiring, then account-deletion coherence, then the mobile store/hook/screen and navigation, then property-based and integration tests. Everything is testable in CI (backend) and locally (mobile) with Centrifugo and the WebSocket mocked — zero real Centrifugo calls.

Scope is text-only, no message edit/delete (no `deleted_at`), no read receipts, no durable offline outbox, no translation/attachments. Conversation opens at match; a conversation stays OPEN only while its match is valid. See `requirements.md` (8 requirements + REQ-P1…REQ-P9) and `design.md` (P1–P19).

## Tasks

- [ ] 1. Backend config, constants & schema
  - [ ] 1.1 Add chat + Centrifugo-token env to `.env.example`
    - Add `CHAT_CONNECTION_TOKEN_TTL_SECONDS`, `CHAT_MESSAGE_MAX_LENGTH`, `CHAT_HISTORY_PAGE_SIZE`, `CHAT_CHANNEL_PREFIX` (default `chat:conversation:`); document that `CENTRIFUGO_TOKEN_SECRET` (already present) is now consumed for connection/subscription tokens; add optional mobile `EXPO_PUBLIC_CHAT_MESSAGE_MAX_LENGTH` / `EXPO_PUBLIC_CHAT_HISTORY_PAGE_SIZE` / `EXPO_PUBLIC_CHAT_SEND_TIMEOUT_MS`
    - _Requirements: 7.1, 7.2, 7.3_
  - [ ] 1.2 Create chat constants with startup validation
    - Create `services/api/src/chat/chat.constants.ts`: parse the `CHAT_*` values + reference `CENTRIFUGO_TOKEN_SECRET`/`CENTRIFUGO_API_*`; `validateChatConfig()` fail-fast (non-test): token secret non-empty, TTL/max-length/page-size positive, channel prefix non-empty; no hardcoded values in logic
    - _Requirements: 4.5, 7.1 · P12_
  - [ ] 1.3 Create the chat schema migration
    - Create `services/api/src/migrations/1700000019000-CreateChatTables.ts` (reversible `up()`/`down()`, `IF NOT EXISTS`): `chat_conversations` (`UNIQUE thread_id`; `thread_id`/`offer_id` FKs `ON DELETE CASCADE`; `host_id`/`cleaner_id` FKs `ON DELETE SET NULL`, nullable; `status`, `message_seq` default 0, `last_message_at`) and `chat_messages` (`sequence_number` `UNIQUE (conversation_id, sequence_number)`; `client_message_id` `UNIQUE (conversation_id, client_message_id)`; `type`, `body`, NO `deleted_at`; `conversation_id` FK CASCADE, `sender_id` FK `ON DELETE SET NULL` nullable; indexes incl. `(conversation_id, sequence_number DESC)`, all FK columns, `last_message_at`); table/column comments
    - _Requirements: 8.1, 8.2, 8.3, 8.5 · P6, P18_

- [ ] 2. Entities & types
  - [ ] 2.1 Create chat entities
    - Create `services/api/src/chat/entities/chat-conversation.entity.ts` and `chat-message.entity.ts` mirroring the negotiation entity conventions (timestamptz, snake_case columns, checks for `status`/`type`, `@Unique`/`@Index` matching the migration)
    - _Requirements: 8.1_
  - [ ] 2.2 Create chat domain types + error messages
    - Create `services/api/src/chat/chat.types.ts` (`ConversationView`, `MessageView`, `SendResult`, `ConversationStatus`, `MessageType`) and `chat.messages.ts` (error strings; bodies never embedded verbatim)
    - _Requirements: 1.1, 2.1, 7.4_

- [ ] 3. Chat repository (serialized send transaction)
  - [ ] 3.1 Implement ChatRepository
    - Create `services/api/src/chat/chat.repository.ts`: `insertMessage` as ONE serialized transaction (`SELECT ... FOR UPDATE` the conversation → verify `OPEN` inside the lock → dedup on `(conversation_id, client_message_id)`: identical payload returns existing, different payload signals conflict → `409` → bump `message_seq` → insert with `sequence_number = next` → update `last_message_at`); `openOrGetConversationForThread` (idempotent upsert, only when matched); `isParticipant`; `getMessagesBefore` / `getMessagesAfter` (keyset); `listConversationsForUser` (inbox with last-message summary, `last_message_at` desc); `closeConversationForThread`; parameterized SQL only
    - _Requirements: 1.2, 2.1, 2.3, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 8.4, 8.5 · P2, P4, P5, P6, P8, P16, P17_
  - [ ]* 3.2 Unit tests for ChatRepository
    - idempotent open-or-get; sequence unique + strictly increasing under concurrent insert (gaps allowed); dedup identical→existing / different→conflict; OPEN-check inside the lock rejects sends to a concurrently-closed conversation; keyset `before` and `after` (no gap/overlap); inbox ordering; participant check; atomic `last_message_at`
    - _Requirements: 1.2, 2.3, 2.5, 2.6, 3.2, 3.3, 8.4, 8.5 · P2, P5, P6, P8, P16, P17_

- [ ] 4. Participation service, Centrifugo token service & endpoint (auth-owned)
  - [ ] 4.1 Implement ChatParticipationService
    - Create `services/api/src/chat/chat-participation.service.ts`: `isParticipant(userId, conversationId): Promise<boolean>` via `ChatRepository`; the single source of the participation rule, exported from `ChatModule` for auth to consume
    - _Requirements: 1.4, 4.3 · P3, P10_
  - [ ] 4.2 Implement CentrifugoTokenService
    - Create `services/api/src/auth/centrifugo/centrifugo-token.service.ts`: `mintConnectionToken(userId)` (HS256 `{ sub, exp }`) and `mintSubscriptionToken(userId, channel)` (HS256 `{ sub, channel, exp }`) via `CENTRIFUGO_TOKEN_SECRET`; bounded TTL from config; subject always the authenticated user, never client-supplied; pure/testable
    - _Requirements: 4.1, 4.2 · P10, P11_
  - [ ] 4.3 Implement the token controller
    - Create `services/api/src/auth/centrifugo/centrifugo.controller.ts`: `GET /auth/centrifugo/token` (`JwtAuthGuard`), resolves `req.user.keycloakId` → `User`; no `channel` → connection token; `?channel=chat:conversation:{id}` → subscription token only when `ChatParticipationService.isParticipant(user.id, id)` is true (identity from JWT, id in channel string never trusted), else `403`
    - _Requirements: 4.1, 4.3, 4.4 · P3, P10_
  - [ ]* 4.4 Unit tests for token service, participation & controller
    - sign/verify/expiry; connection-token subject = caller; subscription token only for participants; non-participant / other-channel denied `403`; tampered/expired rejected; missing secret fails fast
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5 · P3, P10, P11, P12_

- [ ] 5. Chat service
  - [ ] 5.1 Implement ChatService
    - Create `services/api/src/chat/chat.service.ts`: match verification (thread has `ACCEPTED` proposal via `NegotiationRepository`) before opening; participant authorization; body validation (non-empty, ≤ `CHAT_MESSAGE_MAX_LENGTH`); delegates the `OPEN`-lifecycle check INTO the repository's serialized transaction (no service pre-check race); persist-then-publish orchestration (publish via `CentrifugoClient` best-effort, failure logged not thrown, body never logged verbatim); maps repo payload-mismatch → `409`; `closeConversationForThread` (idempotent); builds views
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7 · P1, P3, P4, P5, P7, P15, P17, P19_
  - [ ]* 5.2 Unit tests for ChatService
    - open only when matched (else reject); non-participant/closed rejected; empty/oversized rejected & nothing persisted; persist-before-publish ordering; publish failure non-blocking (still succeeds); payload-mismatch → 409; body never logged verbatim; views correct
    - _Requirements: 1.3, 1.4, 2.2, 2.4, 2.5, 2.7 · P1, P3, P4, P7, P15, P19_

- [ ] 6. Chat controller & module wiring
  - [ ] 6.1 Implement ChatController + DTOs
    - Create `services/api/src/chat/chat.controller.ts` (`@Controller('chat') @UseGuards(JwtAuthGuard)`): `POST /chat/threads/:threadId/conversation` (open-or-get), `GET /chat/conversations` (inbox), `GET /chat/conversations/:id`, `GET /chat/conversations/:id/messages?before=&limit=`, `?after=&limit=`, `POST /chat/conversations/:id/messages` (Idempotency-Key header + `client_message_id` + `body`); DTOs with `ValidationPipe({ whitelist, forbidNonWhitelisted })`; participant resolution via `req.user.keycloakId`
    - _Requirements: 1.4, 2.3, 2.5, 3.1, 3.2, 3.3, 3.4_
  - [ ] 6.2 Wire ChatModule + auth centrifugo + app.module
    - Create `services/api/src/chat/chat.module.ts` (TypeOrm entities, reuse `CentrifugoClient` via `OffersModule` export or shared realtime provider, negotiation match lookup; export `ChatParticipationService`); register `CentrifugoTokenController`/`CentrifugoTokenService` in the auth module importing `ChatParticipationService`; register `ChatModule` in `app.module.ts`; call `validateChatConfig()` on boot
    - _Requirements: 4.5, 7.1_
  - [ ]* 6.3 Controller integration tests
    - match → open → send → persisted + published + summary updated; history via `before`/`after`; non-participant `403`; closed conversation `409`; publish-failure still `201` and present in history
    - _Requirements: 1.4, 2.2, 2.5, 3.3, 3.4 · P4, P8, P9, P15_

- [ ] 7. Match-invalidation lifecycle wiring
  - [ ] 7.1 Close conversation on offer-terminal / thread-CLOSED
    - Invoke `ChatService.closeConversationForThread(threadId)` from the existing negotiation/offer terminal transition (event listener or direct call in the existing close path); idempotent; CLOSED rejects new sends, keeps history readable; no new scheduler
    - _Requirements: 1.5, 1.6 · P17_
  - [ ]* 7.2 Tests for lifecycle close
    - offer-terminal and thread-CLOSED both close the conversation idempotently; a send after close is rejected; history still readable
    - _Requirements: 1.5, 1.6, 2.5 · P8, P17_

- [ ] 8. Account-deletion coherence
  - [ ] 8.1 Confirm/align chat deletion policy
    - Verify the migration's `ON DELETE SET NULL` on `host_id`/`cleaner_id`/`sender_id` (never `CASCADE` from `users`) is coherent with `DeletionJobProcessor` (which anonymizes PII + marks `DELETED`, no physical user delete); if an explicit chat step is warranted, add an idempotent non-destructive step + `DeletionStep` entry; otherwise document that SET NULL + global PII anonymization suffices
    - _Requirements: 8.2, 8.3 · P18_
  - [ ]* 8.2 Test deletion coherence
    - deleting/anonymizing a participant leaves the conversation + message history intact with `sender_id`/participant columns nulled; parent thread/offer removal cascades the conversation
    - _Requirements: 8.2, 8.3 · P18_

- [ ] 9. Checkpoint — backend compiles, tests green, CI-equivalent
  - Ensure `services/api` typechecks, ESLint (`--max-warnings 0`) clean on touched files, and the full API suite passes; ask the user if questions arise.

- [ ] 10. Mobile core (types, constants, api, store)
  - [ ] 10.1 Create mobile chat types & constants
    - Create `apps/mobile/src/screens/chat/chat.types.ts` (`ChatConversation`, `ChatMessage` incl. local `sendState`, `SendState` sending|sent|failed, `ConnectionStatus`) and `chat.constants.ts` (routes, channel prefix, max length, page size, send timeout, i18n keys; `EXPO_PUBLIC_*`)
    - _Requirements: 6.3, 7.3_
  - [ ] 10.2 Implement chat.api.ts
    - Create `apps/mobile/src/screens/chat/chat.api.ts`: typed `apiClient` calls (open-or-get by thread, list conversations, get conversation, history `before`, history `after`, send, get connection token, get subscription token)
    - _Requirements: 2.1, 3.1, 3.2, 3.3_
  - [ ] 10.3 Implement chat.store.ts (Zustand)
    - Create `apps/mobile/src/screens/chat/chat.store.ts`: `ChatState` (conversations, messagesByConversation, connectionStatus) + actions (`loadConversations`, `openConversation`, `loadOlder`, `reconcileNewer`, `sendMessage` optimistic by `clientMessageId` with bounded timeout→failed, `onIncomingMessage` upsert/dedup by `id`+`clientMessageId` in `sequenceNumber` order, `reset`)
    - _Requirements: 5.2, 5.5, 5.6, 3.1, 3.2, 3.3 · P13_
  - [ ]* 10.4 Unit tests for chat.store
    - optimistic send + timeout→failed + reconcile once; incoming dedup by id/clientMessageId; insert in sequenceNumber order; `loadOlder` (before) + `reconcileNewer` (after) paging; reset
    - _Requirements: 5.2, 5.5, 3.2, 3.3 · P13_

- [ ] 11. Mobile realtime hook & screen
  - [ ] 11.1 Implement useChatChannel
    - Create `apps/mobile/src/screens/chat/useChatChannel.ts` mirroring `useCentrifugoChannel`: fetch connection + subscription token, connect WS to `chat:conversation:{id}`, unwrap Centrifugo push envelope, bounded-backoff reconnect, foreground reconcile via `after` (fetch newer than last held sequence), teardown; no duplicate subscriptions; calls store actions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 2.7 · P13, P14, P15, P19_
  - [ ] 11.2 Implement ChatScreen + components
    - Create `apps/mobile/src/screens/chat/ChatScreen.tsx` + `components/{MessageBubble,MessageComposer,ConversationHeader}.tsx`: history render, own vs counterparty, send-state (sending/sent/failed) affordance, compose→send; dark tokens
    - _Requirements: 6.3, 6.5_
  - [ ] 11.3 Add chat i18n (en + es)
    - Create `apps/mobile/src/i18n/locales/en/chat.json` and `es/chat.json` (parity): header, composer placeholder, send states, empty/error states
    - _Requirements: 6.4_
  - [ ]* 11.4 Unit tests for useChatChannel & ChatScreen
    - hook: token fetch, reconnect/backoff, foreground reconcile via `after`, teardown, no duplicate subscription (WS + apiClient mocked); screen: renders own/counterparty, send states, i18n
    - _Requirements: 5.3, 5.4, 6.3 · P14_

- [ ] 12. Navigation wiring (both roles)
  - [ ] 12.1 Mount ChatScreen for Host and Cleaner
    - Add a `Chat` route to the Host Offers stack (`HostNavigator`) opened from `OfferDetailScreen` when matched; introduce a small stack in the Cleaner `Active` tab (`CleanerNavigator`) to mount `ChatScreen`; both open the matched conversation
    - _Requirements: 6.1, 6.2_

- [ ] 13. Checkpoint — full chat UX integrated on mobile
  - Ensure store + hook + screen + navigation + i18n work together against mocks; mobile `tsc --noEmit` + ESLint + Jest clean; ask the user if questions arise.

- [ ] 14. Property-Based Tests (fast-check)
  - [ ]* 14.1 Property: Idempotent send, payload-checked (backend)
    - **P5** — **Validates: Requirements 2.3 · REQ-P5** — arbitrary retries/interleavings of the same `client_message_id`: identical payload persists exactly one message; different payload → `409`
  - [ ]* 14.2 Property: Sequence total order, gaps allowed (backend)
    - **P6** — **Validates: Requirements 2.6, 8.5 · REQ-P4** — concurrent inserts yield unique, strictly increasing `sequence_number`; contiguity not required
  - [ ]* 14.3 Property: Keyset history both cursors (backend)
    - **P8** — **Validates: Requirements 3.1, 3.2, 3.3 · REQ-P9** — `before` and `after` paging over random histories has no gaps/overlaps and correct ordering
  - [ ]* 14.4 Property: Token scoping (backend)
    - **P10** — **Validates: Requirements 4.1, 4.3 · REQ-P2** — connection-token subject is the authenticated caller; subscription token issued only to participants (by lookup, not channel string)
  - [ ]* 14.5 Property: Client dedup & order (mobile)
    - **P13** — **Validates: Requirements 5.2, 5.5 · REQ-P6** — arbitrary interleavings of live + fetched + optimistic messages render each once, in `sequenceNumber` order

- [ ] 15. Integration & Scenario Tests
  - [ ]* 15.1 Integration: match → open → send → history (backend)
    - matched thread opens a conversation; send persists + publishes + updates summary atomically; history via `before`/`after` returns it correctly ordered
    - _Requirements: 1.1, 2.1, 3.3, 3.4 · P1, P4, P9, P16_
  - [ ]* 15.2 Integration: authorization & lifecycle (backend)
    - non-participant denied read/write/subscribe; unmatched thread has no conversation; closed conversation rejects send; match invalidation closes the conversation
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.5 · P1, P3, P17_
  - [ ]* 15.3 Integration: transport resilience (backend + mobile)
    - publish failure still persists + `201`; client reconnect reconciles missed messages via `after` without duplicates; no immediate-delivery guarantee, recovery via reconciliation
    - _Requirements: 2.2, 2.7, 5.3, 5.6 · P4, P14, P15, P19_

- [ ] 16. Final Checkpoint — all tests pass, CI green, docs updated
  - Ensure the full API suite + mobile suite pass and CI-equivalent commands are green; update module READMEs (`services/api/src/chat`, `apps/mobile/src/screens/chat`, auth README note), `docs/ARCHITECTURE.md` (chat module + Centrifugo chat flows), `docs/CHANGELOG.md`, and at least the transport/authority ADR; mark the spec complete in ROADMAP; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (unit, property-based, integration).
- Each task references specific requirements; property/integration tests cite the design's P1–P19 and the requirements' REQ-P1…REQ-P9.
- **Source of truth = PostgreSQL; Centrifugo = transport only** (mirrors the offers pipeline). Persist before publish; publish failure never loses a message. v1 gives NO immediate-realtime-delivery guarantee — recovery is via the `after` reconciliation cursor (P19).
- **Send is one serialized transaction** under the conversation row lock: OPEN-check + dedup(+payload-mismatch→409) + sequence + insert + atomic `last_message_at`. No check-then-act race with close (P17).
- **Authorization = the matched thread's `{hostId, cleanerId}`**, for both REST and Centrifugo subscription; identity from the JWT subject, never the channel string.
- **Ownership:** auth owns token issuance (`/auth/centrifugo/token`, consuming `CENTRIFUGO_TOKEN_SECRET`); chat owns the participation rule (`ChatParticipationService`). Chat has no `AuthController`.
- **Deletion coherence:** participant FKs + `sender_id` are `ON DELETE SET NULL` (never CASCADE from `users`); only `thread_id`/`offer_id` cascade (P18).
- **No new realtime dependency:** `useChatChannel` reuses the raw-WebSocket approach of `useCentrifugoChannel`.
- **Out of scope:** message edit/delete (no `deleted_at`), read/delivery receipts in persistence/correctness, durable offline outbox, translation (LibreTranslate), attachments/voice (Spec 14)/video, VoIP (Spec 15), group chat, push notifications for messages.
- CI: backend jobs (API lint/typecheck, API tests, AI tests) must stay green; mobile is verified locally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 10, "tasks": ["12.1"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5"] },
    { "id": 12, "tasks": ["15.1", "15.2", "15.3"] }
  ]
}
```

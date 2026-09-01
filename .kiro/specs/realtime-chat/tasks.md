# Implementation Plan: Realtime Chat

## Overview

`realtime-chat` adds post-match Host↔Cleaner messaging. It is full-stack but thin, built on existing seams: the backend reuses the `CentrifugoClient` (publish) and the `JwtAuthGuard`, attaches a conversation to a matched `negotiation_thread`, and persists to PostgreSQL first (source of truth) then publishes to Centrifugo (transport). The single missing infra piece — the `GET /auth/centrifugo/token` endpoint the mobile client already calls — is introduced here, signing with the currently-unused `CENTRIFUGO_TOKEN_SECRET`. The mobile side mirrors the existing `useCentrifugoChannel` lifecycle in a new `useChatChannel` (no new dependency).

Implementation is bottom-up: config/constants + migration + entities first, then the token service + endpoint, then the repository, service, and controller, then the mobile store/hook/screen and navigation wiring, then property-based and integration tests. Everything is testable in CI (backend) and locally (mobile) with Centrifugo and the WebSocket mocked — zero real Centrifugo calls.

Scope is text-only, no translation, no attachments, conversation opens at match. See `requirements.md` (8 requirements) and `design.md` (P1–P16).

## Tasks

- [ ] 1. Backend config, constants & schema
  - [ ] 1.1 Add chat + Centrifugo-token env to `.env.example`
    - Add `CHAT_CONNECTION_TOKEN_TTL_SECONDS`, `CHAT_MESSAGE_MAX_LENGTH`, `CHAT_HISTORY_PAGE_SIZE`, `CHAT_CHANNEL_PREFIX`; document that `CENTRIFUGO_TOKEN_SECRET` (already present) is now consumed for connection/subscription tokens
    - _Requirements: 7.1, 7.2_
  - [ ] 1.2 Create chat constants with startup validation
    - Create `services/api/src/chat/chat.constants.ts`: parse the `CHAT_*` values + `CENTRIFUGO_TOKEN_SECRET`/`CENTRIFUGO_API_*`; `validateChatConfig()` fail-fast (non-test): token secret non-empty, TTL/max-length/page-size positive, channel prefix non-empty
    - _Requirements: 4.5, 7.1, P12_
  - [ ] 1.3 Create the chat schema migration
    - Create `services/api/src/migrations/1700000019000-CreateChatTables.ts` (reversible `up()`/`down()`, `IF NOT EXISTS`): `chat_conversations` (UNIQUE `thread_id`, FKs to threads/offers/users with `ON DELETE CASCADE`, `status`, `last_message_at`) and `chat_messages` (`sequence_number` UNIQUE per conversation, `client_message_id` UNIQUE per conversation, `type`, `body`, `deleted_at`, FKs, indexes incl. `(conversation_id, sequence_number DESC)` and partial active index); table/column comments
    - _Requirements: 8.1, 8.2, 8.5_

- [ ] 2. Entities & types
  - [ ] 2.1 Create chat entities
    - Create `services/api/src/chat/entities/chat-conversation.entity.ts` and `chat-message.entity.ts` mirroring the negotiation entity conventions (timestamptz, snake_case, checks, indexes)
    - _Requirements: 8.1_
  - [ ] 2.2 Create chat domain types + error messages
    - Create `services/api/src/chat/chat.types.ts` (ConversationView, MessageView, SendResult, ConversationStatus) and `chat.messages.ts` (error strings)
    - _Requirements: 1.1, 2.1_

- [ ] 3. Centrifugo token service & endpoint
  - [ ] 3.1 Implement CentrifugoTokenService
    - Create `services/api/src/auth/centrifugo/centrifugo-token.service.ts`: `mintConnectionToken(userId)` (HS256 `{ sub, exp }` via `CENTRIFUGO_TOKEN_SECRET`) and `mintSubscriptionToken(userId, channel)`; bounded TTL from config; pure/testable
    - _Requirements: 4.1, 4.2, P10, P11_
  - [ ] 3.2 Implement the token controller
    - Create `services/api/src/auth/centrifugo/centrifugo.controller.ts`: `GET /auth/centrifugo/token` (`JwtAuthGuard`) returning a connection token; optional `?channel=chat:conversation:{id}` returns a subscription token only when the caller is a participant (via `ChatRepository.isParticipant`), else `403`
    - _Requirements: 4.1, 4.3, 4.4, P3, P10_
  - [ ]* 3.3 Unit tests for token service & controller
    - sign/verify/expiry; subject is caller's own id; subscription token only for participants; tampered/expired rejected; missing secret fails fast
    - _Requirements: 4.1, 4.2, 4.3, 4.5, P10, P11, P12_

- [ ] 4. Chat repository
  - [ ] 4.1 Implement ChatRepository
    - Create `services/api/src/chat/chat.repository.ts`: `openOrGetConversationForThread` (idempotent, only when matched), `isParticipant`, transactional `insertMessage` assigning concurrency-safe `sequence_number` + dedup on `(conversation_id, client_message_id)`, `getMessagesBefore(conversationId, beforeSeq, limit)` keyset, `listConversationsForUser` (inbox with last-message), `closeConversationForOffer`; parameterized SQL only
    - _Requirements: 1.2, 2.1, 2.3, 2.6, 3.1, 3.2, 3.3, 8.4_
  - [ ]* 4.2 Unit tests for ChatRepository
    - idempotent open-or-get; sequence monotonic/unique under concurrent insert; dedup by client_message_id; keyset paging no gap/overlap; inbox ordering; participant check
    - _Requirements: 1.2, 2.3, 2.6, 3.2, 8.4, P2, P5, P6, P8_

- [ ] 5. Chat service
  - [ ] 5.1 Implement ChatService
    - Create `services/api/src/chat/chat.service.ts`: match verification (thread has ACCEPTED proposal) before opening; participant + `OPEN`-lifecycle authorization; body validation (non-empty, ≤ max length); persist-then-publish (publish via `CentrifugoClient` best-effort, failure logged not thrown); build views
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4, 2.5, P1, P3, P4, P7, P15_
  - [ ]* 5.2 Unit tests for ChatService
    - open only when matched; non-participant/closed rejected; empty/oversized rejected; persist-before-publish; publish failure non-blocking; views correct
    - _Requirements: 1.3, 1.4, 2.2, 2.4, 2.5, P1, P3, P4, P7_

- [ ] 6. Chat controller & module wiring
  - [ ] 6.1 Implement ChatController + DTOs
    - Create `services/api/src/chat/chat.controller.ts` (`@Controller('chat') @UseGuards(JwtAuthGuard)`): list/get conversations, keyset messages, send (Idempotency-Key + `client_message_id`), open-or-get by thread; DTOs with `ValidationPipe({ whitelist, forbidNonWhitelisted })`; role/participant resolution via `req.user.keycloakId`
    - _Requirements: 1.4, 2.3, 2.5, 3.1, 3.2, 3.3_
  - [ ] 6.2 Wire ChatModule + AuthModule + app.module
    - Create `services/api/src/chat/chat.module.ts` (TypeOrm entities, import realtime `CentrifugoClient` source, NegotiationRepository/threads access), register the centrifugo controller/service in the auth module, and register `ChatModule` in `app.module.ts`; call `validateChatConfig()` on boot
    - _Requirements: 4.5, 7.1_
  - [ ]* 6.3 Controller integration tests
    - send→persist→history end-to-end; non-participant 403; closed conversation 409; publish-failure still 201 and present in history
    - _Requirements: 1.4, 2.2, 2.5, 3.4, P4, P9, P15_

- [ ] 7. Account-deletion integration
  - [ ] 7.1 Add chat cleanup to the deletion cascade
    - Extend `DeletionJobProcessor` with a chat step (remove/anonymize the user's messages and close/remove conversations) consistent with existing steps; add the step name to `DeletionStep`; idempotent + retry-safe
    - _Requirements: 8.3, P16_
  - [ ]* 7.2 Test the chat deletion step
    - extend the PII-anonymization/cascade test to assert chat cleanup independent of ordering
    - _Requirements: 8.3, P16_

- [ ] 8. Checkpoint — backend compiles, tests green, CI-equivalent
  - Ensure `services/api` typechecks, ESLint (`--max-warnings 0`) clean on touched files, and the full API suite passes; ask the user if questions arise.

- [ ] 9. Mobile core (types, constants, api, store)
  - [ ] 9.1 Create mobile chat types & constants
    - Create `apps/mobile/src/screens/chat/chat.types.ts` (ChatConversation, ChatMessage, SendState) and `chat.constants.ts` (routes, channel prefix, max length, page size, i18n keys; `EXPO_PUBLIC_*`)
    - _Requirements: 6.3, 7.3_
  - [ ] 9.2 Implement chat.api.ts
    - Create `apps/mobile/src/screens/chat/chat.api.ts`: typed `apiClient` calls (list, get, history keyset, send, open-conversation, get connection/subscription token)
    - _Requirements: 3.1, 3.2, 2.1_
  - [ ] 9.3 Implement chat.store.ts (Zustand)
    - Create `apps/mobile/src/screens/chat/chat.store.ts`: state (conversations, messagesByConversation, connectionStatus) + actions (loadConversations, openConversation, loadOlder, sendMessage optimistic by clientMessageId, onIncomingMessage dedup+order, reconcile, reset)
    - _Requirements: 5.2, 5.5, 3.1, 3.2_
  - [ ]* 9.4 Unit tests for chat.store
    - optimistic send + reconcile once; incoming dedup by id/clientMessageId; insert in sequenceNumber order; loadOlder paging; reset
    - _Requirements: 5.2, 5.5, P13_

- [ ] 10. Mobile realtime hook & screen
  - [ ] 10.1 Implement useChatChannel
    - Create `apps/mobile/src/screens/chat/useChatChannel.ts` mirroring `useCentrifugoChannel`: fetch token, connect WS to `chat:conversation:{id}`, unwrap Centrifugo push envelope, bounded-backoff reconnect, foreground reconcile (fetch newer than last held), teardown; calls store actions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, P13, P14, P15_
  - [ ] 10.2 Implement ChatScreen + components
    - Create `apps/mobile/src/screens/chat/ChatScreen.tsx` + `components/{MessageBubble,MessageComposer,ConversationHeader}.tsx`: history render, own vs counterparty, send-state (sending/sent/failed), compose→send; dark tokens
    - _Requirements: 6.3, 6.5_
  - [ ] 10.3 Add chat i18n (en + es)
    - Create `apps/mobile/src/i18n/locales/en/chat.json` and `es/chat.json` (parity): header, composer placeholder, send states, empty/error states
    - _Requirements: 6.4_
  - [ ]* 10.4 Unit tests for useChatChannel & ChatScreen
    - hook: token fetch, reconnect/backoff, foreground reconcile, teardown, no duplicate subscription (WS + apiClient mocked); screen: renders own/counterparty, send states, i18n
    - _Requirements: 5.3, 5.4, 6.3, P14_

- [ ] 11. Navigation wiring (both roles)
  - [ ] 11.1 Mount ChatScreen for Host and Cleaner
    - Add a `Chat` route to the Host Offers stack (`HostNavigator`) opened from `OfferDetailScreen` when matched; introduce a small stack in the Cleaner `Active` tab (`CleanerNavigator`) to mount `ChatScreen`; both open the matched conversation
    - _Requirements: 6.1, 6.2_

- [ ] 12. Checkpoint — full chat UX integrated on mobile
  - Ensure store + hook + screen + navigation + i18n work together against mocks; mobile `tsc --noEmit` + ESLint + Jest clean; ask the user if questions arise.

- [ ] 13. Property-Based Tests (fast-check)
  - [ ]* 13.1 Property: Idempotent send (backend)
    - **P5** — **Validates: Requirements 2.3** — arbitrary retries/interleavings of the same `client_message_id` persist exactly one message
  - [ ]* 13.2 Property: Sequence total order (backend)
    - **P6** — **Validates: Requirements 2.6, 8.4** — concurrent inserts yield strictly increasing, unique `sequence_number`
  - [ ]* 13.3 Property: Keyset history (backend)
    - **P8** — **Validates: Requirements 3.1, 3.2** — paging with `before/limit` over random histories has no gaps/overlaps and is newest-first
  - [ ]* 13.4 Property: Token scoping (backend)
    - **P10** — **Validates: Requirements 4.1, 4.3** — connection token subject is the caller; subscription token issued only to participants
  - [ ]* 13.5 Property: Client dedup & order (mobile)
    - **P13** — **Validates: Requirements 5.2, 5.5** — arbitrary interleavings of live + fetched + optimistic messages render each once, in order

- [ ] 14. Integration & Scenario Tests
  - [ ]* 14.1 Integration: match → open → send → history (backend)
    - matched thread opens a conversation; send persists + publishes; history returns it ordered
    - _Requirements: 1.1, 2.1, 3.4, P1, P4, P9_
  - [ ]* 14.2 Integration: authorization (backend)
    - non-participant denied read/write/subscribe; unmatched thread has no conversation; closed conversation rejects send
    - _Requirements: 1.3, 1.4, 1.5, 2.5, P1, P3_
  - [ ]* 14.3 Integration: transport resilience (backend + mobile)
    - publish failure still persists + `201`; client reconnect reconciles missed messages without duplicates
    - _Requirements: 2.2, 5.3, 5.6, P4, P14, P15_

- [ ] 15. Final Checkpoint — all tests pass, CI green, docs updated
  - Ensure the full API suite + mobile suite pass and CI-equivalent commands are green; update module READMEs, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, at least one ADR, and mark the spec complete in ROADMAP; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed.
- Each task references specific requirements; property tests cite the design's P1–P16.
- **Source of truth = PostgreSQL; Centrifugo = transport only** (mirrors the offers pipeline). Persist before publish; publish failure never loses a message.
- **Authorization = the matched thread's `{hostId, cleanerId}`**, for both REST and Centrifugo subscription. The token endpoint never trusts client-supplied identity.
- **The `/auth/centrifugo/token` endpoint is new infrastructure** the mobile client already expects; it consumes the previously-unused `CENTRIFUGO_TOKEN_SECRET`.
- **No new realtime dependency:** `useChatChannel` reuses the raw-WebSocket approach of `useCentrifugoChannel`.
- **Out of scope:** translation (LibreTranslate), attachments/voice (Spec 14)/video, VoIP (Spec 15), group chat, push notifications for messages.
- CI: backend jobs (API lint/typecheck, API tests, AI tests) must stay green; mobile is verified locally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["11.1"] },
    { "id": 10, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3"] }
  ]
}
```

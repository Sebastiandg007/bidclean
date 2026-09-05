# Requirements Document

## Introduction

The `realtime-chat` module lets a **matched Host and Cleaner communicate in real time** to coordinate a cleaning service after they have agreed on price. It is the first feature of Sprint 4 (Communication) and the foundation the later communication specs build on: `voice-notes` (Spec 14) and `voip-calls` (Spec 15) both attach to a chat conversation.

Today the platform has everything needed to reach a match but nothing to talk afterward. `offer-negotiation` (Spec 8) produces a `negotiation_threads` row per `(offer, host, cleaner)` and marks a match by setting a `negotiation_proposals` row to `ACCEPTED`; the accepted thread already carries both participant ids (`hostId`, `cleanerId`) and the `offerId`. Realtime transport also already exists but only for one direction: `offers` publishes offer events to Cleaner personal channels through a server-side `CentrifugoClient` (`services/api/src/offers/delivery/centrifugo.client.ts`), and the mobile radar consumes a Centrifugo WebSocket via `useCentrifugoChannel`. What is missing is (a) a **Centrifugo connection/subscription token endpoint** — the mobile client already calls `GET /auth/centrifugo/token`, but no backend route issues it and the declared `CENTRIFUGO_TOKEN_SECRET` is unused — and (b) a **chat domain** (messages, per-conversation channel, send/history endpoints, and a mobile chat UI).

This spec introduces exactly that: a backend `chat` module that owns chat conversations and messages, persists every message in PostgreSQL (the source of truth), and publishes it over Centrifugo (the transport) to the other participant; plus a mobile chat feature (store, realtime hook, screen, i18n) reachable by both roles from the offer/match surface. The Centrifugo token endpoint is owned by the **auth module**, not chat (see ownership boundary below).

**Authority split (kept strict, mirroring the rest of the codebase):**

- **PostgreSQL is the source of truth for messages.** Every message is durably persisted before it is published; Centrifugo is a transport layer only (exactly as the offers pipeline treats it). A dropped WebSocket never loses a message — history is re-fetched from the API.
- **The match owns who may chat.** A conversation exists for, and only for, a matched `negotiation_thread` (a thread with an `ACCEPTED` proposal). The only participants are that thread's `hostId` and `cleanerId`. Authorization for both the REST endpoints and the Centrifugo subscription derives from that pair — never from client-supplied identity.
- **Keycloak is the identity authority.** The same `JwtAuthGuard` that protects existing endpoints protects the chat endpoints, and the same Keycloak subject is what the Centrifugo connection token is minted for. The token endpoint derives identity from the authenticated JWT `sub`, never from a client-supplied user id or from the channel name.

**Ownership boundary — token issuance vs. chat authorization:**

- The **auth module** owns and exposes `GET /auth/centrifugo/token`: it authenticates the Keycloak subject and mints the HMAC-signed connection token, and (for private channels) mints a subscription token. The `chat` module does **not** introduce its own `AuthController`.
- The **chat module** owns the *rule* that decides participation: given an authenticated subject and a conversation id, is the subject that conversation's `hostId` or `cleanerId`? The auth token endpoint consults this rule (via a chat participation check) when minting a subscription token for `chat:conversation:{id}`.
- This keeps identity/token concerns in auth and participation/business concerns in chat, with a one-directional dependency (auth → chat participation check) and no duplicated auth surface.

**Deliberate scope boundaries (to keep the MVP correct and shippable):**

- **No message translation in this spec.** The product is multilingual (ES/EN/FR/DE/IT/PT/NL) and LibreTranslate is planned, but no translation client exists yet in the codebase. Per-message translation is explicitly out of scope and deferred to a later spec/ADR; messages are sent and shown verbatim.
- **No attachments (image/voice/video) in this spec.** Text messages only. Voice notes are Spec 14; image attachments are a later addition. The message model keeps a `type` discriminator so attachments can be added without a breaking migration, but only `TEXT` is implemented.
- **Messages are immutable in v1 — no edit, no delete.** There is no message editing and no soft-delete/tombstone in v1 (no `deleted_at`, no delete endpoint, no delete authorization). If message deletion is required later it will be introduced in its own spec with its own tombstone semantics. This deliberately reduces surface and state.
- **No new realtime library.** The mobile client reuses the existing raw-WebSocket approach (a new `useChatChannel` hook mirroring `useCentrifugoChannel`'s lifecycle), not `centrifuge-js`, to avoid an unnecessary native dependency for the MVP.
- **No full offline outbox in v1.** "Realtime unavailable" (WebSocket down) is not the same as "no network". When the WebSocket is down but the network is up, messages still send via REST. When there is no network at all, a composed message stays locally `failed`/`pending` and may be retried (with the same `client_message_id`) once connectivity returns; there is no durable offline queue/outbox in v1.
- **Read receipts are out of the v1 persistence/correctness model.** A message may show a local send state (sending/sent/failed) for UX, but delivered/read receipts are NOT part of v1 persistence or correctness and MUST NOT drive any schema (`message_reads`, `message_deliveries`, `last_seen_at`) or authorization. They may be added later as a pure presentation feature.
- **Conversation opens at match, not before.** Pre-match communication is the negotiation flow itself (offers/counteroffers). A chat conversation becomes available only once the thread is matched (`ACCEPTED`), reflecting the product model "agree on price, then coordinate the job."

## Domain Model Overview

```
negotiation_threads (Spec 8)  ── has ACCEPTED proposal ──►  MATCH  (hostId, cleanerId, offerId)
        │                                                     │
        │ 1:1 (opened at match, idempotent)                   │ authorizes
        ▼                                                     ▼
chat_conversations ──────────────────────────────►  participants = { hostId, cleanerId }
        │  id, thread_id, offer_id, host_id, cleaner_id, status(OPEN|CLOSED),
        │  last_message_at, created_at
        │ 1:N (keyset by sequence_number)
        ▼
chat_messages
        id, conversation_id, sender_id, type(TEXT), body,
        sequence_number (unique + strictly increasing per conversation; gaps allowed),
        client_message_id (idempotency/dedup), created_at
        (NO deleted_at — messages are immutable in v1)

WRITE PATH (source of truth first, transport second — atomic summary update):
  POST /chat/conversations/:id/messages
        └─► TRANSACTION: persist chat_messages row (assign sequence_number,
              dedup on (conversation_id, client_message_id)) AND update
              conversations.last_message_at atomically                       [PostgreSQL = truth]
              └─► publish to Centrifugo channel  chat:conversation:{id}       [transport, best-effort]
                    └─► other participant's WebSocket receives it live

READ PATH (two explicit cursors):
  GET /chat/conversations                                → the caller's conversations (last_message_at desc)
  GET /chat/conversations/:id/messages?before=<seq>&limit=N   → OLDER history (newest→older, backward scroll)
  GET /chat/conversations/:id/messages?after=<seq>&limit=N    → NEWER messages (reconnect reconciliation)

REALTIME AUTH (identity from JWT, never from the channel name):
  GET /auth/centrifugo/token                       → HMAC connection token, sub = authenticated Keycloak subject
  GET /auth/centrifugo/token?channel=chat:conversation:{id}
        → subscription token issued IFF (authenticated subject) is a participant of conversation {id},
          resolved by a server-side conversation lookup — the {id}/cleanerId in the channel string is never trusted
```

- A **conversation** is the durable parent of a chat; it is 1:1 with a matched `negotiation_thread` and immutable in its participants (`hostId`, `cleanerId`) and `offerId`. It is created idempotently and concurrency-safely at (or on first access after) match.
- A **message** is an immutable, durably-persisted text entry authored by one participant, ordered within its conversation by a `sequence_number` that is unique and strictly increasing but not necessarily gap-free. `client_message_id` makes sends idempotent and lets the sender reconcile optimistic UI.
- **Centrifugo is transport only.** A message is committed to PostgreSQL first; publishing is a best-effort side effect. If publish fails, the message still exists and both clients converge via history fetch — identical to how the offers pipeline treats Centrifugo.
- **The conversation channel is `chat:conversation:{conversationId}`**, following the existing colon-namespaced convention (`offers:cleaner:{id}`). Only the two participants may subscribe, enforced by the auth token endpoint via a chat participation lookup keyed on the authenticated subject.
- **Realtime events are idempotent by `message.id`.** The same message event may be delivered/processed more than once; the client upserts by `message.id` (and reconciles optimistic sends by `client_message_id`) so no duplicate ever renders. No separate event-id entity is needed.
- **Both roles reach chat from the match:** the Host opens it from the offer/match detail (Offers stack), the Cleaner from their active/matched job surface. The screen is role-agnostic — it renders the same conversation for whichever participant is viewing.

## Glossary

- **Conversation** — the durable parent record of a chat, 1:1 with a matched negotiation thread; participants are the thread's Host and Cleaner.
- **Message** — an immutable, persisted text entry in a conversation, ordered by `sequence_number`.
- **Match** — a negotiation thread with an `ACCEPTED` proposal; the precondition for a conversation to exist.
- **Match validity** — the condition under which a conversation may stay OPEN: the thread is not CLOSED/invalidated and the offer is not terminal. Loss of match validity closes the conversation.
- **Participant** — one of the exactly two users of a conversation: the thread's `hostId` or `cleanerId`.
- **Connection token** — an HMAC-signed JWT minted by the auth module for the authenticated Keycloak subject, used by the mobile client to authenticate its Centrifugo WebSocket connection.
- **Subscription token** — an HMAC-signed token authorizing a subscription to a specific private channel; issued only when the authenticated subject is a participant of that conversation.
- **Subscription authorization** — the server-side check that the authenticated subject may subscribe to `chat:conversation:{id}` because a conversation lookup shows they are that conversation's `hostId` or `cleanerId`.
- **`client_message_id`** — a client-generated id sent with each message so retries are idempotent and optimistic UI can be reconciled.
- **`sequence_number`** — a per-conversation integer establishing total message order; unique and strictly increasing, not necessarily contiguous (gaps allowed).
- **Centrifugo** — the self-hosted WebSocket server used as the realtime transport; never the source of truth.

## Requirements

### Requirement 1 — Conversation exists for, and only for, a valid match

**User Story:** As a matched Host or Cleaner, I want a private conversation tied to our agreed job, so that I can coordinate the cleaning with the exact counterparty I matched with.

#### Acceptance Criteria

1. WHEN a negotiation thread has an `ACCEPTED` proposal THEN the system SHALL make exactly one chat conversation available for that thread, with `hostId`, `cleanerId`, and `offerId` copied from the thread.
2. WHEN a conversation is requested for a matched thread THEN creation SHALL be idempotent and concurrency-safe: concurrent open requests SHALL return the same single conversation (enforced by upsert semantics plus a `UNIQUE(thread_id)` constraint), never forking the chat.
3. IF a negotiation thread has no `ACCEPTED` proposal THEN the system SHALL NOT expose a conversation for it, and any attempt to open one SHALL be rejected.
4. WHEN a user who is neither the conversation's `hostId` nor its `cleanerId` requests the conversation or its messages THEN the system SHALL respond `403` and reveal nothing about its contents.
5. WHEN the underlying match ceases to be valid — the offer becomes terminal (cancelled/expired/completed) OR the negotiation thread is otherwise CLOSED/invalidated — THEN the system SHALL mark the conversation `CLOSED`. A conversation stays `OPEN` only while its underlying match remains valid; chat lifecycle does not depend on `offer.state` alone.
6. WHEN a conversation is `CLOSED` THEN new messages SHALL be rejected while existing history remains readable, subject to the platform's account/data retention policy (chat does not define its own retention exception).

### Requirement 2 — Send a message (durable first, then realtime)

**User Story:** As a participant, I want my message stored reliably and delivered instantly to the other person, so that coordination is both dependable and immediate.

#### Acceptance Criteria

1. WHEN a participant POSTs a text message to an `OPEN` conversation THEN the system SHALL, in a single transaction, persist it to PostgreSQL — assigning a `sequence_number` and recording `sender_id`, `body`, and `created_at` — AND update the conversation's `last_message_at`, BEFORE any realtime publish.
2. WHEN a message has been persisted THEN the system SHALL publish it to the conversation's Centrifugo channel as a best-effort side effect, and a publish failure SHALL NOT fail the request nor lose the message.
3. WHEN two sends carry the same `client_message_id` for the same conversation THEN the system SHALL treat it as an idempotent retry ONLY when the payload is identical: same `client_message_id` + same immutable payload SHALL persist one message and return the existing one; same `client_message_id` + a DIFFERENT payload SHALL be rejected with `409 CONFLICT` and persist nothing, so the idempotency contract cannot be corrupted.
4. IF the message body is empty, whitespace-only, or exceeds the configured maximum length THEN the system SHALL reject it with `400` and persist nothing.
5. WHEN a non-participant, or a participant posting to a `CLOSED` conversation, attempts to send THEN the system SHALL reject with `403`/`409` respectively and persist nothing. The `OPEN`-lifecycle check SHALL be evaluated inside the same serialized transaction that assigns the sequence and inserts the message (under the conversation row lock), so a conversation that is concurrently CLOSED can never admit a new message (no check-then-act race).
6. WHEN a message is persisted THEN its `sequence_number` SHALL be unique within the conversation and strictly greater than every prior message's, establishing a total order independent of timestamps; sequence numbers need NOT be gap-free (e.g. `1 < 2 < 4` is valid).
7. WHEN a message is not delivered live because the realtime publish failed or the recipient was offline THEN the recipient SHALL recover it through history reconciliation (the `after` cursor); v1 provides no guarantee of immediate realtime delivery — PostgreSQL plus reconciliation is the delivery/consistency guarantee.

### Requirement 3 — Read conversation history (paginated, two cursors)

**User Story:** As a participant returning to a conversation, I want to load the message history in order, page back through older messages, and fetch only what I missed after reconnecting, so that I catch up regardless of connectivity.

#### Acceptance Criteria

1. WHEN a participant requests a conversation's messages without a cursor THEN the system SHALL return the most recent page ordered by `sequence_number`, newest first, capped at a configured page size.
2. WHEN a participant requests messages with `before=<sequence>` THEN the system SHALL return the page of older messages immediately preceding it (keyset pagination, newest→older), enabling backward scroll without offset drift.
3. WHEN a participant requests messages with `after=<sequence>` THEN the system SHALL return messages newer than that sequence (oldest of the new set first, or a defined order), enabling reconnect reconciliation to fetch only missed messages rather than reloading the whole conversation.
4. WHEN a participant lists their conversations THEN the system SHALL return only conversations they participate in, ordered by `last_message_at` (most recent first), each with enough summary to render an inbox row (counterparty, offer reference, last message preview, timestamp).
5. WHEN history is fetched THEN the response SHALL be independent of realtime state, so a client that missed live events converges to the correct, complete order from PostgreSQL alone.

### Requirement 4 — Centrifugo connection & subscription authorization (owned by auth)

**User Story:** As a participant, I want a secure realtime connection that only lets me listen to my own conversations, so that no one can eavesdrop on chats they are not part of.

#### Acceptance Criteria

1. WHEN an authenticated user requests a Centrifugo connection token THEN the auth module SHALL mint an HMAC-signed token (using the configured `CENTRIFUGO_TOKEN_SECRET`) whose subject is derived from the caller's authenticated JWT `sub`, never from a client-supplied id.
2. WHEN the connection token is minted THEN it SHALL carry a bounded expiry, and an expired or tampered token SHALL be rejected by Centrifugo so the client must refresh.
3. WHEN a client requests a subscription token for `chat:conversation:{id}` THEN it SHALL be issued only if a server-side conversation lookup shows the authenticated subject is that conversation's `hostId` or `cleanerId`. The identity used is the authenticated subject; the id embedded in the channel string is never trusted as proof of participation.
4. IF a user requests subscription authorization for a conversation they do not participate in (including by naming another conversation's channel) THEN the system SHALL deny it, and the user SHALL receive no messages from that channel.
5. WHEN the token secret or Centrifugo API configuration is missing in a production environment THEN the system SHALL fail fast at startup rather than issue unusable tokens or silently disable chat.

### Requirement 5 — Realtime delivery & resilient mobile client

**User Story:** As a participant with an unreliable mobile connection, I want live messages when connected and automatic recovery when not, so that the conversation always reflects reality without manual refresh.

#### Acceptance Criteria

1. WHEN the mobile client opens a conversation THEN it SHALL fetch history from the API AND subscribe to the conversation channel, so the view is correct even before the first live event.
2. WHEN a live message arrives on the channel THEN the client SHALL append it in `sequence_number` order, de-duplicating against messages already loaded by `message.id` (and by `client_message_id` for its own optimistic sends), so a re-delivered event never renders twice.
3. WHEN the WebSocket disconnects THEN the client SHALL reconnect with bounded exponential backoff (mirroring the existing radar hook) and, on reconnect, reconcile by fetching messages `after` the last `sequence_number` it holds.
4. WHEN the app returns to the foreground THEN the client SHALL re-verify the connection and reconcile missed messages without creating duplicate subscriptions or duplicate rendered messages.
5. WHEN the client sends a message THEN it SHALL show it optimistically keyed by `client_message_id`, transition it to `failed` after a bounded client timeout or explicit network failure (retryable with the same `client_message_id`), and reconcile with the server's persisted message (same `client_message_id`) when it arrives — never rendering it twice.
6. WHEN the WebSocket is unavailable but the network is up THEN send-via-REST and history-fetch SHALL still work (functional non-live mode). WHEN there is no network at all THEN the composed message SHALL remain locally `failed`/`pending` for retry; there is no durable offline outbox in v1.

### Requirement 6 — Mobile chat UX for both roles

**User Story:** As either a Host or a Cleaner, I want to reach and use the chat from my matched job, so that coordinating is a natural step after we agree.

#### Acceptance Criteria

1. WHEN a Host views a matched offer THEN the system SHALL provide an entry point to open that match's conversation from the Offers surface.
2. WHEN a Cleaner views a matched/active job THEN the system SHALL provide an entry point to open the same conversation from the Cleaner surface.
3. WHEN a participant opens the conversation THEN the screen SHALL render the message history, distinguish own vs counterparty messages, show send state (sending/sent/failed), and provide a compose input bound to the send flow.
4. WHEN all UI text is rendered THEN it SHALL come from i18n translation keys with `en` and `es` in parity (other locales are future work), consistent with the app's i18n conventions.
5. WHEN the screen uses colors/spacing THEN it SHALL follow the BidClean dark design tokens used across the app.

### Requirement 7 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want chat behavior and secrets driven by configuration, so that the feature is portable across environments and leaks no secrets.

#### Acceptance Criteria

1. WHEN chat reads any tunable (message max length, history page size, token TTL, channel namespace prefix, Centrifugo URLs/secrets) THEN it SHALL come from environment/config constants, with none hardcoded in logic.
2. WHEN the backend signs Centrifugo tokens THEN the signing secret SHALL be read from server configuration and never shipped to or exposed in the client.
3. WHEN the mobile client needs the WebSocket URL or token endpoint THEN it SHALL read them from `EXPO_PUBLIC_*` config (reusing the existing `EXPO_PUBLIC_CENTRIFUGO_*` variables) rather than literals.
4. WHEN message content is stored, published, or handled THEN it SHALL be treated as untrusted user input — validated for length, stored via parameterized queries, and its body SHALL NOT be written verbatim to application logs, audit logs, metrics, or error messages.
5. WHEN a new backend module, entity, migration, or mobile feature folder is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram, CHANGELOG) per the project documentation rules.

### Requirement 8 — Persistence, ordering, and lifecycle integrity

**User Story:** As the platform, I want chat data modeled and cleaned up correctly, so that ordering is reliable and deleted users/offers leave no orphaned or inconsistent chat state.

#### Acceptance Criteria

1. WHEN chat tables are created THEN they SHALL follow the project's database standards: UUID primary keys, snake_case names, `timestamptz` timestamps, explicit FK `ON DELETE` behavior, and indexes on every FK and on the `(conversation_id, sequence_number)` read path.
2. WHEN a conversation references a negotiation thread and offer THEN those FKs (`thread_id`, `offer_id`) SHALL use `ON DELETE CASCADE` so removing the parent thread/offer removes the conversation coherently (no dangling conversations). The participant FKs (`host_id`, `cleaner_id`) SHALL NOT cascade from `users` — see 8.3.
3. WHEN a user account is deleted THEN chat SHALL be coherent with the platform's central deletion policy, which anonymizes PII and marks the user `DELETED` but does NOT physically remove the `users` row. Accordingly: the participant FK columns (`host_id`, `cleaner_id`) and `sender_id` SHALL use `ON DELETE SET NULL` (never `CASCADE` from `users`), so that even a hypothetical hard user delete cannot destroy a shared conversation or its history. A conversation is never dropped because one participant is deleted; the deleted user's identity is anonymized (consistent with the global PII anonymization) while the conversation and message history are retained per the central retention policy. The single unresolvable-simultaneously combination the design MUST avoid is `CASCADE`-from-`users` on a participant column together with a retain-history guarantee.
4. WHEN a message is inserted THEN both the message row and the conversation's `last_message_at` summary SHALL be updated atomically (same transaction), so the inbox ordering can never observe a new message without its updated summary.
5. WHEN two near-simultaneous sends occur in one conversation THEN `sequence_number` assignment SHALL be concurrency-safe (row-locked counter or equivalent) with `UNIQUE(conversation_id, sequence_number)` as the backstop, yielding distinct, strictly increasing sequence numbers (gaps permitted).

## Correctness Properties (business invariants)

These are the invariants the design's verifiable properties and the tests must uphold. The design document defines the concrete, testable properties (with its own numbering) and maps each back to these.

- **REQ-P1 — Conversation uniqueness.** One negotiation thread → at most one conversation. *(Req 1.2)*
- **REQ-P2 — Participant isolation.** Only `hostId` and `cleanerId` may read, send, or subscribe. *(Req 1.4, 2.5, 4.3, 4.4)*
- **REQ-P3 — Durable-first.** No persisted message → no successful send; a publish failure never loses a message. *(Req 2.1, 2.2)*
- **REQ-P4 — Message ordering.** Sequence numbers are unique and strictly increasing per conversation (gaps allowed). *(Req 2.6, 8.5)*
- **REQ-P5 — Idempotent send (payload-checked).** Same `client_message_id` + same payload → same single server message; same `client_message_id` + different payload → `409`. *(Req 2.3)*
- **REQ-P6 — Realtime idempotency.** The same message event may be processed multiple times without producing a duplicate UI entry (upsert by `message.id`). *(Req 5.2)*
- **REQ-P7 — Conversation lifecycle follows match validity.** A conversation may be created/opened only for a matched thread; an OPEN conversation may be sent to only while the match is valid; a CLOSED conversation remains readable by its participants. *(Req 1.1, 1.3, 1.5, 1.6)*
- **REQ-P8 — Closed conversation.** Closed → no new messages (enforced inside the serialized send transaction); history remains readable subject to the retention policy. *(Req 1.5, 1.6, 2.5)*
- **REQ-P9 — REST reconciliation.** After reconnect, local history converges to the PostgreSQL state via the `after` cursor, independent of realtime. *(Req 3.3, 3.5, 5.3)*

## Non-Goals

- Message translation (LibreTranslate) — deferred to a later spec.
- Attachments: images, voice notes (Spec 14), video, files — text only here.
- Message editing and deletion (no `deleted_at`/tombstones in v1) — a future spec if needed.
- Read/delivery receipts and presence beyond simple connection state — not part of v1 persistence/correctness.
- A durable offline outbox/queue — no-network sends stay locally pending/retryable only.
- VoIP/video calls (Spec 15).
- Group chats or channels beyond the two matched participants.
- Any change to the negotiation/offer flow, the commission math, or subscription/ads modules.
- Backend push notifications for new messages (OneSignal integration is a separate spec); this spec covers in-app realtime only.

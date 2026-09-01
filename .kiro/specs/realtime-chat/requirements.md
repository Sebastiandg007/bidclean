# Requirements Document

## Introduction

The `realtime-chat` module lets a **matched Host and Cleaner communicate in real time** to coordinate a cleaning service after they have agreed on price. It is the first feature of Sprint 4 (Communication) and the foundation the later communication specs build on: `voice-notes` (Spec 14) and `voip-calls` (Spec 15) both attach to a chat conversation.

Today the platform has everything needed to reach a match but nothing to talk afterward. `offer-negotiation` (Spec 8) produces a `negotiation_threads` row per `(offer, host, cleaner)` and marks a match by setting a `negotiation_proposals` row to `ACCEPTED`; the accepted thread already carries both participant ids (`hostId`, `cleanerId`) and the `offerId`. Realtime transport also already exists but only for one direction: `offers` publishes offer events to Cleaner personal channels through a server-side `CentrifugoClient` (`services/api/src/offers/delivery/centrifugo.client.ts`), and the mobile radar consumes a Centrifugo WebSocket via `useCentrifugoChannel`. What is missing is (a) a **Centrifugo connection/subscription token endpoint** — the mobile client already calls `GET /auth/centrifugo/token`, but no backend route issues it and the declared `CENTRIFUGO_TOKEN_SECRET` is unused — and (b) a **chat domain** (messages, per-conversation channel, send/history endpoints, and a mobile chat UI).

This spec introduces exactly that: a backend `chat` module that owns chat conversations and messages, mints per-participant Centrifugo tokens scoped to a conversation channel, persists every message in PostgreSQL (the source of truth), and publishes it over Centrifugo (the transport) to the other participant; plus a mobile chat feature (store, realtime hook, screen, i18n) reachable by both roles from the offer/match surface.

**Authority split (kept strict, mirroring the rest of the codebase):**

- **PostgreSQL is the source of truth for messages.** Every message is durably persisted before it is published; Centrifugo is a transport layer only (exactly as the offers pipeline treats it). A dropped WebSocket never loses a message — history is re-fetched from the API.
- **The match owns who may chat.** A conversation exists for, and only for, a matched `negotiation_thread` (a thread with an `ACCEPTED` proposal). The only participants are that thread's `hostId` and `cleanerId`. Authorization for both the REST endpoints and the Centrifugo subscription derives from that pair — never from client-supplied identity.
- **Keycloak is the identity authority.** The same `JwtAuthGuard` that protects existing endpoints protects the chat endpoints, and the same Keycloak subject is what the Centrifugo connection token is minted for. The token endpoint never trusts a client-supplied user id.

**Deliberate scope boundaries (to keep the MVP correct and shippable):**

- **No message translation in this spec.** The product is multilingual (ES/EN/FR/DE/IT/PT/NL) and LibreTranslate is planned, but no translation client exists yet in the codebase. Per-message translation is explicitly out of scope and deferred to a later spec/ADR; messages are sent and shown verbatim.
- **No attachments (image/voice/video) in this spec.** Text messages only. Voice notes are Spec 14; image attachments are a later addition. The message model leaves room for a `type` discriminator so attachments can be added without a breaking migration, but only `TEXT` is implemented.
- **No new realtime library.** The mobile client reuses the existing raw-WebSocket approach (a new `useChatChannel` hook mirroring `useCentrifugoChannel`'s lifecycle), not `centrifuge-js`, to avoid an unnecessary native dependency for the MVP.
- **Conversation opens at match, not before.** Pre-match communication is the negotiation flow itself (offers/counteroffers). A chat conversation becomes available only once the thread is matched (`ACCEPTED`), reflecting the product model "agree on price, then coordinate the job."

## Domain Model Overview

```
negotiation_threads (Spec 8)  ── has ACCEPTED proposal ──►  MATCH  (hostId, cleanerId, offerId)
        │                                                     │
        │ 1:1 (opened at match)                               │ authorizes
        ▼                                                     ▼
chat_conversations ──────────────────────────────►  participants = { hostId, cleanerId }
        │  id, thread_id, offer_id, host_id, cleaner_id, status(OPEN|CLOSED),
        │  last_message_at, created_at
        │ 1:N (keyset by sequence_number)
        ▼
chat_messages
        id, conversation_id, sender_id, type(TEXT), body, sequence_number (monotonic per conversation),
        client_message_id (idempotency/dedup), created_at, deleted_at?

WRITE PATH (source of truth first, transport second):
  POST /chat/conversations/:id/messages
        └─► persist chat_messages row (assign sequence_number, dedup on client_message_id)   [PostgreSQL = truth]
              └─► publish to Centrifugo channel  chat:conversation:{conversationId}           [transport, best-effort]
                    └─► other participant's WebSocket receives it live

READ PATH:
  GET /chat/conversations            → the caller's conversations (most-recent first)
  GET /chat/conversations/:id/messages?before=<sequence>&limit=N   → keyset history (newest→older)

REALTIME AUTH:
  GET /auth/centrifugo/token   → HMAC-signed connection token for the Keycloak subject (Centrifugo `sub`)
        subscription to  chat:conversation:{id}  authorized iff caller ∈ {hostId, cleanerId} of that conversation
```

- A **conversation** is the durable parent of a chat; it is 1:1 with a matched `negotiation_thread` and immutable in its participants (`hostId`, `cleanerId`) and `offerId`. It is created lazily at (or on first access after) match.
- A **message** is an immutable, durably-persisted text entry authored by one participant, ordered within its conversation by a monotonic `sequence_number` (reused idea from the negotiation thread `version`). `client_message_id` makes sends idempotent and lets the sender reconcile optimistic UI.
- **Centrifugo is transport only.** A message is committed to PostgreSQL first; publishing is a best-effort side effect. If publish fails, the message still exists and both clients converge via history fetch — identical to how the offers pipeline treats Centrifugo.
- **The conversation channel is `chat:conversation:{conversationId}`**, following the existing colon-namespaced convention (`offers:cleaner:{id}`). Only the two participants may subscribe, enforced by the token endpoint.
- **Both roles reach chat from the match:** the Host opens it from the offer/match detail (Offers stack), the Cleaner from their active/matched job surface. The screen is role-agnostic — it renders the same conversation for whichever participant is viewing.
- **Delivery/read state is per-participant and best-effort:** a message may carry a delivered/read marker for UX, but read receipts are a presentational nicety, never an authorization or correctness input.

## Glossary

- **Conversation** — the durable parent record of a chat, 1:1 with a matched negotiation thread; participants are the thread's Host and Cleaner.
- **Message** — an immutable, persisted text entry in a conversation, ordered by `sequence_number`.
- **Match** — a negotiation thread with an `ACCEPTED` proposal; the precondition for a conversation to exist.
- **Participant** — one of the exactly two users of a conversation: the thread's `hostId` or `cleanerId`.
- **Connection token** — an HMAC-signed JWT minted by the backend for the authenticated Keycloak subject, used by the mobile client to authenticate its Centrifugo WebSocket connection.
- **Subscription authorization** — the server-side check that a caller may subscribe to `chat:conversation:{id}` because they are one of that conversation's participants.
- **`client_message_id`** — a client-generated id sent with each message so retries are idempotent and optimistic UI can be reconciled.
- **`sequence_number`** — a per-conversation monotonic integer establishing total message order independent of wall-clock timestamps.
- **Centrifugo** — the self-hosted WebSocket server used as the realtime transport; never the source of truth.

## Requirements

### Requirement 1 — Conversation exists for, and only for, a match

**User Story:** As a matched Host or Cleaner, I want a private conversation tied to our agreed job, so that I can coordinate the cleaning with the exact counterparty I matched with.

#### Acceptance Criteria

1. WHEN a negotiation thread has an `ACCEPTED` proposal THEN the system SHALL make exactly one chat conversation available for that thread, with `hostId`, `cleanerId`, and `offerId` copied from the thread.
2. WHEN a conversation is created for a thread THEN the system SHALL enforce at most one conversation per `thread_id` (unique constraint), so repeated access is idempotent and never forks the chat.
3. IF a negotiation thread has no `ACCEPTED` proposal THEN the system SHALL NOT expose a conversation for it, and any attempt to open one SHALL be rejected.
4. WHEN a user who is neither the conversation's `hostId` nor its `cleanerId` requests the conversation or its messages THEN the system SHALL respond `403` and reveal nothing about its contents.
5. WHEN the underlying offer becomes terminal (cancelled/expired/completed) THEN the system SHALL mark the conversation `CLOSED`, after which new messages are rejected but history remains readable.

### Requirement 2 — Send a message (durable first, then realtime)

**User Story:** As a participant, I want my message stored reliably and delivered instantly to the other person, so that coordination is both dependable and immediate.

#### Acceptance Criteria

1. WHEN a participant POSTs a text message to an `OPEN` conversation THEN the system SHALL persist it to PostgreSQL — assigning a monotonic `sequence_number` and recording `sender_id`, `body`, and `created_at` — BEFORE any realtime publish.
2. WHEN a message has been persisted THEN the system SHALL publish it to the conversation's Centrifugo channel as a best-effort side effect, and a publish failure SHALL NOT fail the request nor lose the message.
3. WHEN two sends carry the same `client_message_id` for the same conversation THEN the system SHALL persist only one message and return the existing one (idempotent send), so a client retry never duplicates.
4. IF the message body is empty, whitespace-only, or exceeds the configured maximum length THEN the system SHALL reject it with `400` and persist nothing.
5. WHEN a non-participant, or a participant posting to a `CLOSED` conversation, attempts to send THEN the system SHALL reject with `403`/`409` respectively and persist nothing.
6. WHEN a message is persisted THEN its `sequence_number` SHALL be strictly greater than every prior message's in the same conversation, establishing a total order independent of timestamps.

### Requirement 3 — Read conversation history (paginated)

**User Story:** As a participant returning to a conversation, I want to load the message history in order and page back through older messages, so that I can catch up regardless of connectivity.

#### Acceptance Criteria

1. WHEN a participant requests a conversation's messages THEN the system SHALL return them ordered by `sequence_number`, newest first, capped at a configured page size.
2. WHEN a participant requests messages `before` a given `sequence_number` THEN the system SHALL return the page of older messages immediately preceding it (keyset pagination), enabling backward scroll without offset drift.
3. WHEN a participant lists their conversations THEN the system SHALL return only conversations they participate in, ordered by `last_message_at` (most recent first), each with enough summary to render an inbox row (counterparty, offer reference, last message preview, timestamp).
4. WHEN history is fetched THEN the response SHALL be independent of realtime state, so a client that missed live events converges to the correct, complete order from PostgreSQL alone.

### Requirement 4 — Centrifugo connection & subscription authorization

**User Story:** As a participant, I want a secure realtime connection that only lets me listen to my own conversations, so that no one can eavesdrop on chats they are not part of.

#### Acceptance Criteria

1. WHEN an authenticated user requests a Centrifugo connection token THEN the system SHALL mint an HMAC-signed token (using the configured `CENTRIFUGO_TOKEN_SECRET`) whose subject is the caller's own identity, never a client-supplied id.
2. WHEN the connection token is minted THEN it SHALL carry a bounded expiry, and an expired or tampered token SHALL be rejected by Centrifugo so the client must refresh.
3. WHEN a client attempts to subscribe to `chat:conversation:{id}` THEN the subscription SHALL be authorized only if the caller is that conversation's `hostId` or `cleanerId`.
4. IF a user requests subscription authorization for a conversation they do not participate in THEN the system SHALL deny it, and the user SHALL receive no messages from that channel.
5. WHEN the token secret or Centrifugo API configuration is missing in a production environment THEN the system SHALL fail fast at startup rather than issue unusable tokens or silently disable chat.

### Requirement 5 — Realtime delivery & resilient mobile client

**User Story:** As a participant with an unreliable mobile connection, I want live messages when connected and automatic recovery when not, so that the conversation always reflects reality without manual refresh.

#### Acceptance Criteria

1. WHEN the mobile client opens a conversation THEN it SHALL fetch history from the API AND subscribe to the conversation channel, so the view is correct even before the first live event.
2. WHEN a live message arrives on the channel THEN the client SHALL append it in `sequence_number` order, de-duplicating against messages already loaded (by message id / `client_message_id`).
3. WHEN the WebSocket disconnects THEN the client SHALL reconnect with bounded exponential backoff (mirroring the existing radar hook) and, on reconnect, reconcile by fetching any messages newer than the last one it holds.
4. WHEN the app returns to the foreground THEN the client SHALL re-verify the connection and reconcile missed messages without creating duplicate subscriptions or duplicate rendered messages.
5. WHEN the client sends a message THEN it SHALL show it optimistically keyed by `client_message_id` and reconcile with the server's persisted message (same `client_message_id`) when it arrives, never rendering it twice.
6. WHEN realtime is unavailable entirely THEN send-via-REST and history-fetch SHALL still work, so chat degrades to a functional non-live mode rather than breaking.

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
4. WHEN message content is stored or published THEN the system SHALL treat it as untrusted user input — validated for length, stored parameterized, and never interpolated into queries or logs verbatim in a way that could leak or inject.
5. WHEN a new backend module, entity, migration, or mobile feature folder is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram, CHANGELOG) per the project documentation rules.

### Requirement 8 — Persistence, ordering, and lifecycle integrity

**User Story:** As the platform, I want chat data modeled and cleaned up correctly, so that ordering is reliable and deleted users/offers leave no orphaned or inconsistent chat state.

#### Acceptance Criteria

1. WHEN chat tables are created THEN they SHALL follow the project's database standards: UUID primary keys, snake_case names, `timestamptz` timestamps, explicit FK `ON DELETE` behavior, and indexes on every FK and on the `(conversation_id, sequence_number)` read path.
2. WHEN a conversation references a negotiation thread and offer THEN the FKs SHALL define cascade behavior such that removing the parent thread/offer removes or closes its conversation coherently (no dangling conversations).
3. WHEN a user account is deleted THEN chat SHALL participate in the existing account-deletion cascade so the user's messages/conversations are handled (removed or anonymized) consistently with how other modules handle deletion, preserving referential integrity.
4. WHEN messages are read for ordering THEN the `sequence_number` assignment SHALL be concurrency-safe, so two near-simultaneous sends in one conversation still receive distinct, strictly increasing sequence numbers.
5. WHEN a message is soft-deleted (if soft delete is used) THEN history queries SHALL exclude it by default via a partial index, while preserving the sequence ordering of remaining messages.

## Non-Goals

- Message translation (LibreTranslate) — deferred to a later spec.
- Attachments: images, voice notes (Spec 14), video, files — text only here.
- VoIP/video calls (Spec 15).
- Group chats or channels beyond the two matched participants.
- Typing indicators and presence beyond simple connection state (may be added later; not required for correctness).
- Any change to the negotiation/offer flow, the commission math, or subscription/ads modules.
- Backend push notifications for new messages (OneSignal integration is a separate spec); this spec covers in-app realtime only.

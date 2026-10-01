# ADR-009: PostgreSQL as the Chat Source of Truth, Centrifugo as Best-Effort Transport, Auth-Owned Token Issuance

## Status
Accepted

## Context
Spec 13 (`realtime-chat`) adds post-match Host↔Cleaner messaging. A conversation exists only for a
**matched** negotiation thread (a thread with an `ACCEPTED` proposal) and its two participants are
the sole authorization basis. The feature is full-stack but thin: it reuses the existing
`CentrifugoClient` (publish) and `JwtAuthGuard`, and the mobile side mirrors the radar's raw-WebSocket
`useCentrifugoChannel` lifecycle.

Several decisions had to be settled before implementation:
- **What is authoritative for messages** — the realtime bus or the database — and what correctness
  guarantee (if any) realtime delivery provides.
- **How message ordering and idempotency** survive retries, concurrent sends, and a conversation
  being closed mid-send.
- **Who issues Centrifugo tokens** and how a subscription is authorized without trusting client input.
- **How the client** presents messages consistently across optimistic sends, live pushes, and
  fetched history.

## Decision
1. **PostgreSQL is the source of truth; Centrifugo is transport only.** A send is *persist-then-publish*:
   the message is committed to `chat_messages` first, then published to the conversation channel
   best-effort. A publish failure is logged (never the body) and never fails the request nor loses the
   message. v1 gives **no immediate-realtime-delivery guarantee** — recovery is via an `after`
   reconciliation cursor on reconnect.
2. **Send is one serialized transaction under the conversation row lock.** Inside `SELECT ... FOR UPDATE`
   on the conversation: verify `OPEN`, dedup on `(conversation_id, client_message_id)` (identical body →
   return existing; different body → 409 conflict), allocate the next `sequence_number` from the
   row-locked `message_seq` counter, insert, and bump `last_message_at` — atomically. This makes
   `sequence_number` unique and strictly increasing per conversation (gaps allowed) and closes the
   check-then-act race with a concurrent close.
3. **Authorization is always the authenticated JWT subject.** Both REST and Centrifugo subscription
   authorization derive identity from the token subject resolved server-side, never a client-supplied id
   nor the id embedded in a channel string. Participation = the matched thread's `{hostId, cleanerId}`.
4. **Auth owns token issuance; chat owns the participation rule.** `GET /auth/centrifugo/token` (auth
   module) mints HS256 connection and per-channel subscription tokens signed with
   `CENTRIFUGO_TOKEN_SECRET`; a subscription token is minted only after `ChatParticipationService`
   (chat module) confirms the caller participates in that conversation. Chat has no `AuthController`.
5. **The client reconstructs one consistent view.** The mobile store orders by `sequence_number` and
   de-duplicates by `id` (server) and `clientMessageId` (own optimistic sends), so the same message
   arriving from an optimistic echo, a live push, and a fetch renders exactly once. Optimistic sends flip
   to `failed` on a bounded timeout and self-heal when the server message arrives.
6. **Match invalidation closes the conversation.** Offer-terminal transitions (CANCELLED/EXPIRED/COMPLETED)
   and thread close idempotently set the conversation `CLOSED`; a closed conversation rejects new sends but
   keeps history readable.

## Reasoning
- **Durability over delivery.** Treating the database as authoritative (mirroring the offers pipeline)
  means a Centrifugo outage degrades to "messages arrive on the next reconciliation" rather than "messages
  are lost." The `after` cursor makes recovery deterministic and testable without a live bus.
- **One lock, no races.** Doing OPEN-check + dedup + sequence + insert + summary in a single row-locked
  transaction is the simplest correct way to guarantee ordering and idempotency and to eliminate the
  check-then-act race against close.
- **Identity from the token, not the channel.** Deriving participation from the JWT subject and a
  server-side lookup — never the channel string — prevents a client from subscribing to a conversation it
  is not part of by crafting a channel name.
- **Clean ownership boundary.** Auth already owns identity and signing secrets; chat owns the domain rule
  for who may talk. Keeping token issuance in auth and the participation rule in chat avoids duplicating
  either concern and keeps chat free of an auth surface.
- **Client dedup by two keys.** Because a message can appear as an optimistic placeholder, a realtime push,
  and a history row, de-duplicating by both `id` and `clientMessageId` (and sorting by `sequence_number`)
  is what makes the UI converge regardless of arrival order.

## Alternatives Considered
- **Centrifugo (or its history) as source of truth.** Rejected: couples correctness to bus availability
  and retention, and offers no transactional ordering/idempotency guarantee; the database already provides
  both.
- **Publish-then-persist, or awaiting publish for success.** Rejected: a transport hiccup would either lose
  a message or fail a send that actually persisted; persist-first with best-effort publish never loses data.
- **Service-level OPEN pre-check before insert.** Rejected: a check-then-act race with a concurrent close;
  the check must live inside the row-locked transaction.
- **Chat issuing its own Centrifugo tokens.** Rejected: duplicates auth's identity/signing responsibility
  and gives chat an auth surface; the participation rule is the only chat-owned concern.
- **Trusting the conversation id in the channel string for authorization.** Rejected: a client could then
  subscribe to any conversation; authorization must be a server-side participation lookup for the JWT
  subject.
- **Read receipts / message edit-delete / durable offline outbox in v1.** Rejected as out of scope; messages
  are immutable (no `deleted_at`) and a failed send is simply retried with the same `clientMessageId`.

## Data Model & Deletion
- `chat_conversations` (UNIQUE `thread_id`; `thread_id`/`offer_id` FKs `ON DELETE CASCADE`;
  `host_id`/`cleaner_id` FKs `ON DELETE SET NULL`, nullable; `status`, `message_seq`, `last_message_at`).
- `chat_messages` (UNIQUE `(conversation_id, sequence_number)` and `(conversation_id, client_message_id)`;
  `conversation_id` FK CASCADE; `sender_id` FK `ON DELETE SET NULL`, nullable; no `deleted_at`).
- **Account deletion coherence:** participant/sender FKs are `SET NULL`, never `CASCADE` from `users`, so
  anonymizing a participant (the deletion processor does `UPDATE`, not physical delete) can never destroy a
  shared conversation or its history; only parent thread/offer removal cascades the conversation.

## Consequences
- Chat has no realtime dependency of its own beyond the existing `CentrifugoClient`; the mobile hook reuses
  the radar's raw-WebSocket approach (no new client dependency).
- Everything is testable in CI (backend) and locally (mobile) with Centrifugo and the WebSocket mocked —
  zero real Centrifugo calls. Correctness is covered by property-based tests (idempotent send, sequence
  order, keyset paging, token scoping) and scenario/integration tests (authorization+lifecycle, transport
  resilience).
- Runtime secrets (`CENTRIFUGO_TOKEN_SECRET`, `CENTRIFUGO_API_*`) live in the VPS `.env`, never in code;
  `validateChatConfig()` fails fast on a missing secret or non-positive tunable.
- Later specs build on this seam without changing the authority model: voice notes (Spec 14), VoIP
  (Spec 15), and message push notifications (Spec 16) attach to the same conversation and reconciliation
  contract.

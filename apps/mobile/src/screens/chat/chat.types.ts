/**
 * chat.types — Mobile domain types for realtime chat.
 *
 * Mirrors the backend `chat` contracts (conversation + message views) plus local-only UI state
 * (`sendState`) for optimistic sends. Messages are ordered by `sequenceNumber` and de-duplicated
 * by `id` (server) / `clientMessageId` (own optimistic sends).
 */

/** Conversation lifecycle status (server-authoritative). */
export type ConversationStatus = 'OPEN' | 'CLOSED';

/** Message type discriminator; only TEXT in v1. */
export type MessageType = 'TEXT';

/** Local send state for optimistic UI (never persisted server-side). */
export type SendState = 'sending' | 'sent' | 'failed';

/** WebSocket connection status surfaced to the UI. */
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/** A chat message as held by the client (server fields + optional local send state). */
export interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string | null;
  readonly type: MessageType;
  readonly body: string;
  readonly sequenceNumber: number;
  readonly clientMessageId: string;
  readonly createdAt: string;
  /** Local-only: present while a send is in flight or failed; absent once server-confirmed. */
  readonly sendState?: SendState;
}

/** A conversation as returned by the backend. */
export interface ChatConversation {
  readonly id: string;
  readonly threadId: string;
  readonly offerId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly status: ConversationStatus;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}

/** An inbox row: a conversation plus a last-message preview. */
export interface ChatConversationSummary extends ChatConversation {
  readonly lastMessagePreview: string | null;
}

/** Result of a send: the persisted message and whether it was an idempotent duplicate. */
export interface ChatSendResult {
  readonly message: ChatMessage;
  readonly deduplicated: boolean;
}

/** A page of messages from a keyset (before/after) history read. */
export interface ChatMessagePage {
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
}

/** A realtime message event payload received over the conversation channel. */
export interface ChatMessageEvent {
  readonly type: 'chat_message';
  readonly message: ChatMessage;
}

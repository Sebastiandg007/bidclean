/**
 * realtime-chat domain types.
 *
 * View shapes returned by the service/controller and the internal result of a send. These are
 * the API-facing contracts the mobile client mirrors; message bodies are plain user text and are
 * never logged verbatim.
 */

/** Conversation lifecycle status. */
export const ConversationStatus = { OPEN: 'OPEN', CLOSED: 'CLOSED' } as const;
export type ConversationStatus =
  (typeof ConversationStatus)[keyof typeof ConversationStatus];

/** Message type discriminator; only TEXT in v1 (kept for future attachment types). */
export const MessageType = { TEXT: 'TEXT' } as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** A single message as returned to clients. */
export interface MessageView {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string | null;
  readonly type: MessageType;
  readonly body: string;
  readonly sequenceNumber: number;
  readonly clientMessageId: string;
  readonly createdAt: string;
}

/** A conversation as returned to clients (single or inbox row). */
export interface ConversationView {
  readonly id: string;
  readonly threadId: string;
  readonly offerId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly status: ConversationStatus;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}

/** An inbox row: a conversation plus a preview of its most recent message. */
export interface ConversationSummaryView extends ConversationView {
  readonly lastMessagePreview: string | null;
}

/**
 * Result of a send/insert. `deduplicated` is true when an idempotent retry (same
 * `clientMessageId` + identical payload) returned the pre-existing message rather than inserting.
 */
export interface SendResult {
  readonly message: MessageView;
  readonly deduplicated: boolean;
}

/** A page of messages returned by a keyset (before/after) history read. */
export interface MessagePage {
  readonly messages: readonly MessageView[];
  readonly hasMore: boolean;
}

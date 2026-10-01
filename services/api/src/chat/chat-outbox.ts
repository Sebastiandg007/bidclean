import { OutboxRow } from '../common/outbox/outbox-writer';

/**
 * Chat domain-owned outbox shaping. The deterministic `event_id` derivation and the minimal
 * payload (ids only — NEVER the message body) live inside the chat bounded context. A voice note
 * IS a chat message, so both TEXT and VOICE inserts write the same `message-created` fact.
 */

/** The physical outbox table owned by the chat bounded context. */
export const CHAT_OUTBOX_TABLE = 'chat_outbox';

/** The aggregate kind for chat outbox rows (app-validated short code). */
export const CHAT_AGGREGATE_TYPE = 'message';

/** The single chat notification-worthy fact: a persisted message (TEXT or VOICE). */
export const CHAT_EVENT_TYPE_MESSAGE_CREATED = 'message-created';

/** Ids the chat `message-created` outbox row carries so the mapper can build the intent. */
export interface MessageCreatedOutboxParams {
  readonly messageId: string;
  readonly conversationId: string;
  readonly recipientUserId: string;
}

/**
 * Build the `chat_outbox` row for a freshly persisted message. The `event_id` is deterministic per
 * message (`message:<messageId>:message-created`) so a redelivery derives the same ledger dedup
 * key (exactly-once intent). Written in the SAME transaction as the message insert.
 */
export function buildMessageCreatedOutboxRow(params: MessageCreatedOutboxParams): OutboxRow {
  return {
    eventId: `${CHAT_AGGREGATE_TYPE}:${params.messageId}:${CHAT_EVENT_TYPE_MESSAGE_CREATED}`,
    aggregateType: CHAT_AGGREGATE_TYPE,
    aggregateId: params.messageId,
    type: CHAT_EVENT_TYPE_MESSAGE_CREATED,
    payload: {
      recipientUserId: params.recipientUserId,
      conversationId: params.conversationId,
    },
    tableName: CHAT_OUTBOX_TABLE,
  };
}
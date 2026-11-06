/**
 * realtime-chat error messages.
 *
 * Centralized, non-sensitive error strings for the chat module. Message BODIES (user content)
 * are never embedded here or in any thrown error — only structural/authorization failures are
 * described, so no user text leaks into logs or responses.
 */
export const CHAT_ERROR_MESSAGES = {
  /** Thread has no ACCEPTED proposal — a conversation may not be opened. */
  THREAD_NOT_MATCHED: 'Conversation is only available after a match',
  /** Conversation does not exist. */
  CONVERSATION_NOT_FOUND: 'Conversation not found',
  /** Caller is neither the host nor the cleaner of the conversation. */
  NOT_A_PARTICIPANT: 'You are not a participant of this conversation',
  /** Conversation is CLOSED — new messages are rejected. */
  CONVERSATION_CLOSED: 'This conversation is closed',
  /** Body is empty or whitespace-only. */
  EMPTY_BODY: 'Message body must not be empty',
  /** Body exceeds the configured maximum length. */
  BODY_TOO_LONG: 'Message body exceeds the maximum allowed length',
  /** Same clientMessageId reused with a different payload. */
  CLIENT_MESSAGE_ID_CONFLICT:
    'clientMessageId was already used with a different message',
  /** The authenticated user could not be resolved. */
  USER_NOT_FOUND: 'User not found',
  /** Missing required Idempotency-Key header on a mutation. */
  MISSING_IDEMPOTENCY_KEY: 'Idempotency-Key header is required',
} as const;

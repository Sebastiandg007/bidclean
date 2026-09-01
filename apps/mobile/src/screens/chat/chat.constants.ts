/**
 * chat.constants — Mobile config, endpoints, channel naming, and i18n keys for realtime chat.
 *
 * Endpoints mirror the backend `chat` controller + the auth Centrifugo token route. Tunables come
 * from `EXPO_PUBLIC_*` with sensible fallbacks (no magic numbers in logic). The channel prefix
 * matches the backend so subscription channel names line up.
 */

/** Backend REST endpoints for chat. */
export const CHAT_ENDPOINTS = {
  CONVERSATIONS: '/chat/conversations',
  conversation: (id: string): string => `/chat/conversations/${id}`,
  messages: (id: string): string => `/chat/conversations/${id}/messages`,
  openForThread: (threadId: string): string => `/chat/threads/${threadId}/conversation`,
} as const;

/** Auth-owned Centrifugo token endpoint (connection + per-channel subscription tokens). */
export const CENTRIFUGO_TOKEN_URL =
  process.env.EXPO_PUBLIC_CENTRIFUGO_TOKEN_URL ?? '/auth/centrifugo/token';

/** Centrifugo WebSocket URL. */
export const CENTRIFUGO_WS_URL =
  process.env.EXPO_PUBLIC_CENTRIFUGO_WS_URL ??
  'wss://ws.bidclean.tech/connection/websocket';

/** Per-conversation channel prefix (matches the backend `CHAT_CHANNEL_PREFIX`). */
export const CHAT_CHANNEL_PREFIX = 'chat:conversation:';

/** Build the Centrifugo channel name for a conversation. */
export function chatChannelForConversation(conversationId: string): string {
  return `${CHAT_CHANNEL_PREFIX}${conversationId}`;
}

/** Max message body length (chars); mirrors the backend bound for a fast client-side check. */
export const CHAT_MESSAGE_MAX_LENGTH = parseInt(
  process.env.EXPO_PUBLIC_CHAT_MESSAGE_MAX_LENGTH ?? '4000',
  10,
);

/** History page size for keyset reads (before/after). */
export const CHAT_HISTORY_PAGE_SIZE = parseInt(
  process.env.EXPO_PUBLIC_CHAT_HISTORY_PAGE_SIZE ?? '50',
  10,
);

/** Client send timeout before an optimistic message flips to `failed` (ms). */
export const CHAT_SEND_TIMEOUT_MS = parseInt(
  process.env.EXPO_PUBLIC_CHAT_SEND_TIMEOUT_MS ?? '15000',
  10,
);

/** Reconnect backoff bounds (mirrors the radar hook's sequence 1s→2s→…→30s). */
export const WS_INITIAL_BACKOFF_MS = 1000;
export const WS_MAX_BACKOFF_MS = 30000;

/** i18n keys for the chat UI (en/es in parity). */
export const CHAT_I18N_KEYS = {
  HEADER_TITLE: 'chat.header.title',
  COMPOSER_PLACEHOLDER: 'chat.composer.placeholder',
  SEND: 'chat.composer.send',
  STATE_SENDING: 'chat.state.sending',
  STATE_SENT: 'chat.state.sent',
  STATE_FAILED: 'chat.state.failed',
  EMPTY: 'chat.empty',
  CLOSED_NOTICE: 'chat.closedNotice',
  LOAD_ERROR: 'chat.loadError',
  CONNECTION_CONNECTED: 'chat.connection.connected',
  CONNECTION_CONNECTING: 'chat.connection.connecting',
  CONNECTION_RECONNECTING: 'chat.connection.reconnecting',
  CONNECTION_DISCONNECTED: 'chat.connection.disconnected',
} as const;

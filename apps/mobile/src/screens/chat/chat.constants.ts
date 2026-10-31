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
  voiceUploadUrl: (id: string): string => `/chat/conversations/${id}/voice-notes/upload-url`,
  voicePlaybackUrl: (id: string, messageId: string): string =>
    `/chat/conversations/${id}/voice-notes/${messageId}/playback-url`,
} as const;

/** Auth-owned Centrifugo token endpoint (connection + per-channel subscription tokens). */
export const CENTRIFUGO_TOKEN_URL =
  process.env.EXPO_PUBLIC_CENTRIFUGO_TOKEN_URL ?? '/auth/centrifugo/token';

/** Centrifugo WebSocket URL. */
export const CENTRIFUGO_WS_URL =
  process.env.EXPO_PUBLIC_CENTRIFUGO_WS_URL ??
  'wss://ws.bidclean.tech/connection/websocket';

/** Navigation route name for the chat entry screen (mounted in both role stacks). */
export const CHAT_ROUTE = 'Chat';

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

// ─── Voice notes (Spec 14) ─────────────────────────────────────────────────────

/**
 * Client-side max recording duration (ms) — a UX pre-check ONLY. The backend/storage limits are
 * authoritative and a manipulated client cannot exceed them.
 */
export const VOICE_MAX_DURATION_MS = parseInt(
  process.env.EXPO_PUBLIC_VOICE_MAX_DURATION_MS ?? '120000',
  10,
);

/** Recording status poll/tick interval (ms) for the elapsed-time display. */
export const VOICE_RECORDER_TICK_MS = 250;

/** The recorded clip MIME type (m4a/aac container from expo-av HIGH_QUALITY preset). */
export const VOICE_RECORDING_MIME_TYPE = 'audio/mp4';

/** The realtime event name for a transcript update (matches the backend publisher). */
export const VOICE_TRANSCRIPT_UPDATED_EVENT = 'voice_transcript_updated';

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
  // Voice notes (Spec 14)
  VOICE_RECORD: 'chat.voice.record',
  VOICE_STOP: 'chat.voice.stop',
  VOICE_RECORDING: 'chat.voice.recording',
  VOICE_PREVIEW_SEND: 'chat.voice.previewSend',
  VOICE_PREVIEW_DISCARD: 'chat.voice.previewDiscard',
  VOICE_PLAY: 'chat.voice.play',
  VOICE_PAUSE: 'chat.voice.pause',
  VOICE_LABEL: 'chat.voice.label',
  VOICE_TRANSCRIPT_PENDING: 'chat.voice.transcript.pending',
  VOICE_TRANSCRIPT_FAILED: 'chat.voice.transcript.failed',
  VOICE_TRANSCRIPT_DISABLED: 'chat.voice.transcript.disabled',
  VOICE_MIC_DENIED: 'chat.voice.micDenied',
  VOICE_TOO_LONG: 'chat.voice.tooLong',
  VOICE_SEND_ERROR: 'chat.voice.sendError',
} as const;

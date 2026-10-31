/**
 * realtime-chat configuration constants.
 *
 * Every configurable value derives from an environment variable with a sensible default; no
 * secret or tunable is hardcoded in logic. Production startup validation
 * ({@link validateChatConfig}) fails fast on any missing/invalid value so a misconfigured
 * deployment never boots with an unusable token secret or nonsensical limits.
 *
 * `CENTRIFUGO_TOKEN_SECRET` / `CENTRIFUGO_API_URL` / `CENTRIFUGO_API_KEY` are SHARED with the
 * existing Centrifugo integration (offers publishing); this module reuses them rather than
 * introducing divergent variables. The token secret — previously declared but unused — is now
 * consumed here to sign connection + per-conversation subscription tokens.
 */

/** HMAC-SHA256 secret used to sign Centrifugo connection + subscription tokens (server-side). */
export const CENTRIFUGO_TOKEN_SECRET = process.env.CENTRIFUGO_TOKEN_SECRET ?? '';

/** Centrifugo HTTP API base URL (shared; used for publishing). */
export const CENTRIFUGO_API_URL = process.env.CENTRIFUGO_API_URL ?? '';

/** Centrifugo HTTP API key (shared; used for publishing). */
export const CENTRIFUGO_API_KEY = process.env.CENTRIFUGO_API_KEY ?? '';

/** Connection/subscription token lifetime in seconds (bounded expiry). */
export const CHAT_CONNECTION_TOKEN_TTL_SECONDS = parseInt(
  process.env.CHAT_CONNECTION_TOKEN_TTL_SECONDS ?? '3600',
  10,
);

/** Max message body length in characters (bodies over this are rejected with 400). */
export const CHAT_MESSAGE_MAX_LENGTH = parseInt(
  process.env.CHAT_MESSAGE_MAX_LENGTH ?? '4000',
  10,
);

/** Default page size for keyset history reads (before/after cursors). */
export const CHAT_HISTORY_PAGE_SIZE = parseInt(
  process.env.CHAT_HISTORY_PAGE_SIZE ?? '50',
  10,
);

/** Channel namespace prefix for per-conversation channels: `chat:conversation:{id}`. */
export const CHAT_CHANNEL_PREFIX =
  process.env.CHAT_CHANNEL_PREFIX ?? 'chat:conversation:';

/** Build the Centrifugo channel name for a conversation. */
export function chatChannelForConversation(conversationId: string): string {
  return `${CHAT_CHANNEL_PREFIX}${conversationId}`;
}

/**
 * Fail-fast startup validation for chat configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws on the first batch of invalid values so a misconfigured deployment never boots.
 */
export function validateChatConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!CENTRIFUGO_TOKEN_SECRET.trim()) {
    errors.push('CENTRIFUGO_TOKEN_SECRET must be a non-empty string');
  }
  if (!CHAT_CHANNEL_PREFIX.trim()) {
    errors.push('CHAT_CHANNEL_PREFIX must be a non-empty string');
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['CHAT_CONNECTION_TOKEN_TTL_SECONDS', CHAT_CONNECTION_TOKEN_TTL_SECONDS],
    ['CHAT_MESSAGE_MAX_LENGTH', CHAT_MESSAGE_MAX_LENGTH],
    ['CHAT_HISTORY_PAGE_SIZE', CHAT_HISTORY_PAGE_SIZE],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid chat configuration:\n- ${errors.join('\n- ')}`);
  }
}

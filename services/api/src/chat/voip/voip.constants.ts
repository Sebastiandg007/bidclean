/**
 * voip-calls configuration constants (Spec 15).
 *
 * Every tunable derives from an environment variable with a sensible default; no secret or limit
 * is hardcoded in logic. Startup validation ({@link validateVoipConfig}) fails fast on any
 * missing/invalid required value so a misconfigured deployment never boots — mirrors
 * `validateChatConfig` / `validateVoiceNotesConfig`. Skipped under NODE_ENV=test (tests inject
 * config directly and run with LiveKit mocked).
 *
 * LiveKit is the live-media transport: its API key/secret sign short-lived, room-scoped access
 * tokens and live ONLY on the server — they reach the client solely as the time-boxed token.
 * Call control is signaled over the EXISTING `chat:conversation:{id}` Centrifugo channel (the
 * chat constants own that); voip introduces no new channel.
 */

/** LiveKit server URL the client connects to for media (returned inside the minted token payload). */
export const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

/** LiveKit API key — signs access tokens (server-side only, never shipped to the client). */
export const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';

/** LiveKit API secret — signs access tokens (server-side only, never shipped to the client). */
export const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';

/**
 * LiveKit webhook signing key/secret. LiveKit signs webhooks with an API key pair; by default the
 * main API credentials are reused, but a dedicated pair may be configured. Resolved via the
 * helpers below so the webhook receiver always has a concrete pair.
 */
export const LIVEKIT_WEBHOOK_API_KEY = process.env.LIVEKIT_WEBHOOK_API_KEY ?? '';
export const LIVEKIT_WEBHOOK_API_SECRET = process.env.LIVEKIT_WEBHOOK_API_SECRET ?? '';

/** Effective webhook key: the dedicated webhook key when set, else the main API key. */
export function livekitWebhookApiKey(): string {
  return LIVEKIT_WEBHOOK_API_KEY.trim() || LIVEKIT_API_KEY;
}

/** Effective webhook secret: the dedicated webhook secret when set, else the main API secret. */
export function livekitWebhookApiSecret(): string {
  return LIVEKIT_WEBHOOK_API_SECRET.trim() || LIVEKIT_API_SECRET;
}

/** Media (LiveKit access) token TTL in seconds — short-lived, room-scoped, identity-scoped. */
export const VOIP_MEDIA_TOKEN_TTL_SECONDS = parseInt(
  process.env.VOIP_MEDIA_TOKEN_TTL_SECONDS ?? '300',
  10,
);

/** Ring window in milliseconds — an unanswered RINGING call past this becomes MISSED via the sweep. */
export const VOIP_RING_TIMEOUT_MS = parseInt(
  process.env.VOIP_RING_TIMEOUT_MS ?? '45000',
  10,
);

/** Stale-call window in milliseconds — ONGOING with media activity older than this is force-ended. */
export const VOIP_STALE_CALL_TIMEOUT_MS = parseInt(
  process.env.VOIP_STALE_CALL_TIMEOUT_MS ?? '90000',
  10,
);

/** Coarse backstop: max call duration in milliseconds — an over-long ONGOING call is force-ended. */
export const VOIP_MAX_CALL_DURATION_MS = parseInt(
  process.env.VOIP_MAX_CALL_DURATION_MS ?? '14400000',
  10,
);

/** Whether video calling is enabled. When false, calls degrade to audio regardless of requested kind. */
export const VOIP_VIDEO_ENABLED =
  (process.env.VOIP_VIDEO_ENABLED ?? 'true').toLowerCase() === 'true';

/** Sweep interval in milliseconds (ring-timeout + stale-call passes). */
export const VOIP_SWEEP_INTERVAL_MS = parseInt(
  process.env.VOIP_SWEEP_INTERVAL_MS ?? '15000',
  10,
);

/** Sweep batch size per pass (bounded, idempotent). */
export const VOIP_SWEEP_BATCH_SIZE = parseInt(
  process.env.VOIP_SWEEP_BATCH_SIZE ?? '100',
  10,
);

/** BullMQ queue + repeatable job names for the voip sweep (ring-timeout + stale-call). */
export const VOIP_SWEEP_QUEUE_NAME = 'voip-calls-sweep';
export const VOIP_SWEEP_JOB_NAME = 'voip-sweep';

/**
 * Default BullMQ job options for the voip sweep queue: the sweep is idempotent and self-healing,
 * so a failed pass is simply retried on the next repeatable tick rather than accumulating history.
 */
export const VOIP_SWEEP_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Call lifecycle statuses (VARCHAR + app validation, never a PG enum). */
export const CallStatus = {
  RINGING: 'RINGING',
  ONGOING: 'ONGOING',
  ENDED: 'ENDED',
  MISSED: 'MISSED',
  DECLINED: 'DECLINED',
  CANCELED: 'CANCELED',
  FAILED: 'FAILED',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

/** The non-terminal statuses: a call in one of these is still live and mutable. */
export const NON_TERMINAL_STATUSES: readonly CallStatus[] = [
  CallStatus.RINGING,
  CallStatus.ONGOING,
];

/** The terminal statuses: immutable audit facts once reached. */
export const TERMINAL_STATUSES: readonly CallStatus[] = [
  CallStatus.ENDED,
  CallStatus.MISSED,
  CallStatus.DECLINED,
  CallStatus.CANCELED,
  CallStatus.FAILED,
];

/** Media kinds. Video is optional and capability-gated. */
export const MediaKind = { AUDIO: 'AUDIO', VIDEO: 'VIDEO' } as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

/** End reasons paired with terminal statuses. */
export const EndReason = {
  HANGUP: 'HANGUP',
  DECLINED: 'DECLINED',
  CANCELED: 'CANCELED',
  TIMEOUT_NO_ANSWER: 'TIMEOUT_NO_ANSWER',
  TIMEOUT: 'TIMEOUT',
  CONVERSATION_CLOSED: 'CONVERSATION_CLOSED',
  ERROR: 'ERROR',
} as const;
export type EndReason = (typeof EndReason)[keyof typeof EndReason];

/** Whether a status is non-terminal (RINGING | ONGOING). */
export function isNonTerminalStatus(status: string): status is CallStatus {
  return (NON_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Whether a status is terminal (immutable). */
export function isTerminalStatus(status: string): status is CallStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Fail-fast startup validation for voip-calls configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws with the full batch of invalid values so a misconfigured deployment never boots.
 */
export function validateVoipConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!LIVEKIT_URL.trim()) {
    errors.push('LIVEKIT_URL must be a non-empty string');
  }
  if (!LIVEKIT_API_KEY.trim()) {
    errors.push('LIVEKIT_API_KEY must be a non-empty string');
  }
  if (!LIVEKIT_API_SECRET.trim()) {
    errors.push('LIVEKIT_API_SECRET must be a non-empty string');
  }
  if (typeof VOIP_VIDEO_ENABLED !== 'boolean') {
    errors.push('VOIP_VIDEO_ENABLED must be a boolean');
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['VOIP_MEDIA_TOKEN_TTL_SECONDS', VOIP_MEDIA_TOKEN_TTL_SECONDS],
    ['VOIP_RING_TIMEOUT_MS', VOIP_RING_TIMEOUT_MS],
    ['VOIP_STALE_CALL_TIMEOUT_MS', VOIP_STALE_CALL_TIMEOUT_MS],
    ['VOIP_MAX_CALL_DURATION_MS', VOIP_MAX_CALL_DURATION_MS],
    ['VOIP_SWEEP_INTERVAL_MS', VOIP_SWEEP_INTERVAL_MS],
    ['VOIP_SWEEP_BATCH_SIZE', VOIP_SWEEP_BATCH_SIZE],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid voip-calls configuration:\n- ${errors.join('\n- ')}`);
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * RevenueCat webhook authentication (pure).
 *
 * Preferred: HMAC-SHA256 over the RAW request body, keyed by the signing secret, with a
 * timestamp-tolerance replay guard and a constant-time comparison. Fallback: a shared-secret
 * bearer token, used only when no signing secret is configured. Raising webhook auth to HMAC
 * matches the sensitivity of a monetization-affecting endpoint (P3).
 */

/** Inputs required to authenticate a webhook request. */
export interface WebhookAuthInput {
  readonly rawBody: string;
  readonly signatureHeader: string | null;
  readonly timestampHeader: string | null;
  readonly authorizationHeader: string | null;
}

/** Configured secrets + replay tolerance. */
export interface WebhookAuthConfig {
  readonly signingSecret: string;
  readonly authSecret: string;
  readonly toleranceSeconds: number;
}

/** The outcome of an authentication attempt. */
export interface WebhookAuthResult {
  readonly ok: boolean;
  /** Machine-readable reason when `ok` is false. */
  readonly reason?:
    | 'no_secret_configured'
    | 'missing_signature'
    | 'invalid_signature'
    | 'stale_timestamp'
    | 'missing_bearer'
    | 'invalid_bearer';
}

const OK: WebhookAuthResult = { ok: true };

/** Constant-time string comparison that never short-circuits on length. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Compare against self to keep timing independent of the mismatch position.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** True when `timestampMs` is within `toleranceSeconds` of `nowMs` (in either direction). */
function isWithinTolerance(timestampMs: number, nowMs: number, toleranceSeconds: number): boolean {
  const ageSeconds = Math.abs(nowMs - timestampMs) / 1000;
  return ageSeconds <= toleranceSeconds;
}

/**
 * Compute the expected HMAC-SHA256 signature (hex) over `${timestamp}.${rawBody}`.
 * Binding the timestamp into the signed content is what makes the replay guard tamper-proof.
 */
export function computeSignature(rawBody: string, timestamp: string, signingSecret: string): string {
  return createHmac('sha256', signingSecret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Verify a webhook request. Prefers HMAC when a signing secret is configured; otherwise falls
 * back to bearer. Returns a structured result rather than throwing so the controller decides
 * the HTTP status. `nowMs` is injectable for deterministic tests.
 */
export function verifyWebhook(
  input: WebhookAuthInput,
  config: WebhookAuthConfig,
  nowMs: number = Date.now(),
): WebhookAuthResult {
  if (config.signingSecret) {
    return verifyHmac(input, config, nowMs);
  }
  if (config.authSecret) {
    return verifyBearer(input.authorizationHeader, config.authSecret);
  }
  return { ok: false, reason: 'no_secret_configured' };
}

function verifyHmac(
  input: WebhookAuthInput,
  config: WebhookAuthConfig,
  nowMs: number,
): WebhookAuthResult {
  if (!input.signatureHeader || !input.timestampHeader) {
    return { ok: false, reason: 'missing_signature' };
  }

  const timestampMs = Number(input.timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  if (!isWithinTolerance(timestampMs, nowMs, config.toleranceSeconds)) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = computeSignature(input.rawBody, input.timestampHeader, config.signingSecret);
  return constantTimeEquals(expected, input.signatureHeader)
    ? OK
    : { ok: false, reason: 'invalid_signature' };
}

function verifyBearer(authorizationHeader: string | null, authSecret: string): WebhookAuthResult {
  if (!authorizationHeader) {
    return { ok: false, reason: 'missing_bearer' };
  }
  const expected = `Bearer ${authSecret}`;
  return constantTimeEquals(expected, authorizationHeader)
    ? OK
    : { ok: false, reason: 'invalid_bearer' };
}

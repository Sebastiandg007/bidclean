import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * OneSignal webhook authentication (pure).
 *
 * HMAC-SHA256 over the RAW request body keyed by the configured webhook secret, with a
 * constant-time comparison. Mirrors the Stripe/RevenueCat webhook auth pattern (a monetization- and
 * privacy-sensitive endpoint). Returns a structured result rather than throwing so the controller
 * decides the HTTP status. The signature header is compared case-insensitively as hex.
 */

/** Inputs required to authenticate a OneSignal webhook request. */
export interface OneSignalAuthInput {
  readonly rawBody: string;
  readonly signatureHeader: string | null;
}

/** The outcome of an authentication attempt. */
export interface OneSignalAuthResult {
  readonly ok: boolean;
  readonly reason?: 'no_secret_configured' | 'missing_signature' | 'invalid_signature';
}

const OK: OneSignalAuthResult = { ok: true };

/** Compute the expected HMAC-SHA256 signature (hex) over the raw body. */
export function computeOneSignalSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Constant-time comparison that never short-circuits on length. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** Strip an optional `sha256=` prefix and lowercase the hex signature. */
function normalizeSignature(signature: string): string {
  const withoutPrefix = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
  return withoutPrefix.trim().toLowerCase();
}

/**
 * Verify a OneSignal webhook. Rejects with a machine-readable reason on a missing/invalid signature
 * or when no secret is configured. `secret` is the server-only `ONESIGNAL_WEBHOOK_SECRET`.
 */
export function verifyOneSignalWebhook(
  input: OneSignalAuthInput,
  secret: string,
): OneSignalAuthResult {
  if (!secret) {
    return { ok: false, reason: 'no_secret_configured' };
  }
  if (!input.signatureHeader) {
    return { ok: false, reason: 'missing_signature' };
  }
  const expected = computeOneSignalSignature(input.rawBody, secret);
  return constantTimeEquals(expected, normalizeSignature(input.signatureHeader))
    ? OK
    : { ok: false, reason: 'invalid_signature' };
}

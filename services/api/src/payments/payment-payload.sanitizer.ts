/**
 * Pure Stripe event payload sanitizer.
 *
 * Whitelists ONLY the fields safe to persist in the `payment_events` ledger:
 * event id, type, object id, amounts, currency, status, and Stripe timestamps.
 * It NEVER persists card numbers/PAN/CVC, `client_secret`, payment-method secrets,
 * or raw customer PII. This protects the ledger from leaking sensitive data.
 */

/** Minimal shape of a Stripe event we read from (kept loose to avoid SDK coupling). */
export interface StripeEventLike {
  readonly id?: string;
  readonly type?: string;
  readonly created?: number;
  readonly data?: { readonly object?: Record<string, unknown> };
}

/** Sanitized snapshot persisted to `payment_events.payload_json`. */
export interface SanitizedPayload {
  readonly eventId: string | null;
  readonly eventType: string | null;
  readonly createdAt: number | null;
  readonly objectId: string | null;
  readonly objectType: string | null;
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly status: string | null;
}

/** Object fields that are safe to read (a strict allowlist). */
const SAFE_OBJECT_FIELDS = [
  'id',
  'object',
  'amount',
  'amount_received',
  'amount_refunded',
  'amount_reversed',
  'currency',
  'status',
] as const;

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Produce a sanitized, whitelisted snapshot of a Stripe event for the ledger.
 *
 * @param event - The Stripe event (or event-like object)
 * @returns Only the whitelisted, non-sensitive fields
 */
export function sanitizeStripePayload(event: StripeEventLike): SanitizedPayload {
  const object = event.data?.object ?? {};
  const picked: Record<string, unknown> = {};
  for (const field of SAFE_OBJECT_FIELDS) {
    if (field in object) {
      picked[field] = object[field];
    }
  }

  const amount =
    asNumberOrNull(picked.amount) ??
    asNumberOrNull(picked.amount_received) ??
    asNumberOrNull(picked.amount_refunded) ??
    asNumberOrNull(picked.amount_reversed);

  return {
    eventId: asStringOrNull(event.id),
    eventType: asStringOrNull(event.type),
    createdAt: asNumberOrNull(event.created),
    objectId: asStringOrNull(picked.id),
    objectType: asStringOrNull(picked.object),
    amountCents: amount,
    currency: asStringOrNull(picked.currency),
    status: asStringOrNull(picked.status),
  };
}

/**
 * RevenueCat webhook payload sanitizer (pure).
 *
 * The ledger stores ONLY a whitelist of safe, audit-relevant fields — never tokens, receipts,
 * fetch tokens, or unnecessary PII. This is a strict allow-list: anything not explicitly copied
 * is dropped. Keeping this pure (no I/O) makes the "no sensitive persistence" property (P9)
 * trivially testable.
 */

/** The whitelisted shape persisted into `subscription_events.payload_json`. */
export interface SanitizedEventPayload {
  readonly eventId: string | null;
  readonly type: string | null;
  readonly appUserId: string | null;
  readonly originalAppUserId: string | null;
  readonly productId: string | null;
  readonly entitlementIds: string[];
  readonly store: string | null;
  readonly environment: string | null;
  readonly periodType: string | null;
  readonly purchasedAtMs: number | null;
  readonly expirationAtMs: number | null;
  readonly eventTimestampMs: number | null;
  /** TRANSFER: the destination app_user_ids (transferred TO). */
  readonly transferredToAppUserIds: string[];
  /** TRANSFER: the source app_user_ids (transferred FROM). */
  readonly transferredFromAppUserIds: string[];
}

/** A RevenueCat webhook body is `{ event: {...}, api_version }`; we treat it as unknown. */
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Extract the whitelisted fields from a raw RevenueCat webhook body.
 * Never throws: missing/malformed fields become null/empty rather than propagating.
 */
export function sanitizeRevenueCatEvent(rawBody: unknown): SanitizedEventPayload {
  const body = asRecord(rawBody);
  const event = asRecord(body?.event) ?? {};

  return {
    eventId: asString(event.id),
    type: asString(event.type),
    appUserId: asString(event.app_user_id),
    originalAppUserId: asString(event.original_app_user_id),
    productId: asString(event.product_id),
    entitlementIds: asStringArray(event.entitlement_ids),
    store: asString(event.store),
    environment: asString(event.environment),
    periodType: asString(event.period_type),
    purchasedAtMs: asNumber(event.purchased_at_ms),
    expirationAtMs: asNumber(event.expiration_at_ms),
    eventTimestampMs: asNumber(event.event_timestamp_ms),
    transferredToAppUserIds: asStringArray(event.transferred_to),
    transferredFromAppUserIds: asStringArray(event.transferred_from),
  };
}

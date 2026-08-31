import {
  EntitlementDelta,
  EntitlementKey,
  RevenueCatEventType,
  Store,
} from '../subscriptions.types';
import { SanitizedEventPayload } from './revenuecat-payload.sanitizer';
import { toEntitlementKeys } from './revenuecat.constants';

/**
 * RevenueCat event -> EntitlementDelta[] mapper (pure).
 *
 * Produces the TARGET per-entitlement state for an event. The mirror is a replica of
 * RevenueCat truth, so ambiguous transitions never force an entitlement inactive: CANCELLATION,
 * BILLING_ISSUE and SUBSCRIPTION_PAUSED keep the entitlement active until its expiry, and
 * reconciliation is the final arbiter. Only EXPIRATION deactivates. TRANSFER yields a pair of
 * deltas (source loses, destination gains) applied atomically by the repository. Unknown event
 * types yield no deltas (recorded in the ledger, mirror untouched).
 */

/** Whether an event type keeps/sets the entitlement active (expiry still governs access). */
function isActivatingEvent(eventType: string): boolean {
  return (
    eventType === RevenueCatEventType.INITIAL_PURCHASE ||
    eventType === RevenueCatEventType.RENEWAL ||
    eventType === RevenueCatEventType.UNCANCELLATION ||
    eventType === RevenueCatEventType.PRODUCT_CHANGE ||
    eventType === RevenueCatEventType.CANCELLATION ||
    eventType === RevenueCatEventType.BILLING_ISSUE ||
    eventType === RevenueCatEventType.SUBSCRIPTION_PAUSED
  );
}

function toStore(store: string | null): Store | null {
  const known = Object.values(Store) as string[];
  return store !== null && known.includes(store) ? (store as Store) : null;
}

function toIso(ms: number | null): string | null {
  return ms !== null ? new Date(ms).toISOString() : null;
}

/** Build one delta per recognized entitlement touched by the event, for a given user + active flag. */
function buildDeltas(
  userId: string,
  keys: readonly EntitlementKey[],
  active: boolean,
  expiresAt: string | null,
  store: Store | null,
  eventTimestampMs: number,
  transferToUserId?: string,
): EntitlementDelta[] {
  return keys.map((entitlementKey) => ({
    userId,
    ...(transferToUserId !== undefined ? { transferToUserId } : {}),
    entitlementKey,
    active,
    expiresAt,
    store,
    eventTimestampMs,
  }));
}

/**
 * Map a sanitized RevenueCat event into the per-entitlement deltas it implies.
 * Returns an empty array for unknown types, missing user, or no recognized entitlement.
 */
export function mapEventToDeltas(event: SanitizedEventPayload): EntitlementDelta[] {
  const eventType = event.type;
  if (eventType === null) {
    return [];
  }

  const keys = toEntitlementKeys(event.entitlementIds);
  if (keys.length === 0) {
    return [];
  }

  const eventTimestampMs = event.eventTimestampMs ?? event.purchasedAtMs ?? Date.now();
  const store = toStore(event.store);

  if (eventType === RevenueCatEventType.TRANSFER) {
    return mapTransfer(event, keys, store, eventTimestampMs);
  }

  const userId = event.appUserId;
  if (userId === null) {
    return [];
  }

  if (eventType === RevenueCatEventType.EXPIRATION) {
    return buildDeltas(userId, keys, false, toIso(event.expirationAtMs), store, eventTimestampMs);
  }

  if (isActivatingEvent(eventType)) {
    return buildDeltas(userId, keys, true, toIso(event.expirationAtMs), store, eventTimestampMs);
  }

  // Recognized-but-not-mutating (should not happen given the union) — leave the mirror untouched.
  return [];
}

/**
 * TRANSFER: remove the entitlement from every source subscriber and grant it to every
 * destination subscriber. Each source delta carries `transferToUserId` so the repository
 * applies both sides in one transaction (P13).
 */
function mapTransfer(
  event: SanitizedEventPayload,
  keys: readonly EntitlementKey[],
  store: Store | null,
  eventTimestampMs: number,
): EntitlementDelta[] {
  const sources = event.transferredFromAppUserIds;
  const destinations = event.transferredToAppUserIds;
  if (sources.length === 0 || destinations.length === 0) {
    return [];
  }

  const expiresAt = toIso(event.expirationAtMs);
  const deltas: EntitlementDelta[] = [];

  for (const sourceUserId of sources) {
    for (const destinationUserId of destinations) {
      // Source loses the entitlement; destination gains it — paired for the atomic write.
      deltas.push(
        ...buildDeltas(sourceUserId, keys, false, expiresAt, store, eventTimestampMs, destinationUserId),
      );
    }
  }

  return deltas;
}

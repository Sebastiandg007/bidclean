import { ENTITLEMENT_ID_MAP } from '../subscriptions.constants';
import { EntitlementKey } from '../subscriptions.types';

/**
 * RevenueCat identifier mapping helpers (pure).
 *
 * The code speaks in logical {@link EntitlementKey}s; RevenueCat speaks in configured
 * entitlement ids (its `lookup_key`). These helpers translate between the two using the
 * configured {@link ENTITLEMENT_ID_MAP} — there is NO hardcoded identifier anywhere.
 */

/**
 * Build the reverse lookup (configured RevenueCat id -> logical key) on demand.
 *
 * Computed per call (not module-scoped) so tests can mutate the env-backed map without a stale
 * cache; the map has three entries, so the cost is negligible.
 */
function buildReverseMap(): ReadonlyMap<string, EntitlementKey> {
  const reverse = new Map<string, EntitlementKey>();
  for (const key of Object.keys(ENTITLEMENT_ID_MAP) as EntitlementKey[]) {
    const configuredId = ENTITLEMENT_ID_MAP[key];
    if (configuredId) {
      reverse.set(configuredId, key);
    }
  }
  return reverse;
}

/**
 * Translate a RevenueCat entitlement id to its internal logical key.
 * Returns null for an unknown/unmapped id (the caller ignores unrecognized entitlements).
 */
export function toEntitlementKey(revenueCatEntitlementId: string): EntitlementKey | null {
  return buildReverseMap().get(revenueCatEntitlementId) ?? null;
}

/** Translate a list of RevenueCat entitlement ids to the recognized logical keys. */
export function toEntitlementKeys(revenueCatEntitlementIds: readonly string[]): EntitlementKey[] {
  const keys: EntitlementKey[] = [];
  for (const id of revenueCatEntitlementIds) {
    const key = toEntitlementKey(id);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

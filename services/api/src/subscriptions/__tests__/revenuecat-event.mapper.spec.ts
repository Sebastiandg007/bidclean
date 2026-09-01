import { RevenueCatEventType } from '../subscriptions.types';
import type { SanitizedEventPayload } from '../revenuecat/revenuecat-payload.sanitizer';
import { mapEventToDeltas } from '../revenuecat/revenuecat-event.mapper';

/**
 * Unit tests for the RevenueCat event mapper.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.6, 2.9, 2.10 (per-type effects incl. PAUSED/BILLING keep-active,
 * TRANSFER source+destination pair, unknown -> no mutation).
 *
 * The entitlement id map (RC_ENTITLEMENT_*) is seeded by test/setup-env.ts before modules load.
 */

function event(overrides: Partial<SanitizedEventPayload>): SanitizedEventPayload {
  return {
    eventId: 'evt',
    type: RevenueCatEventType.RENEWAL,
    appUserId: 'user-1',
    originalAppUserId: 'user-1',
    productId: 'p',
    entitlementIds: ['cleaner_pro'],
    store: 'app_store',
    environment: 'PRODUCTION',
    periodType: 'NORMAL',
    purchasedAtMs: 1_700_000_000_000,
    expirationAtMs: 1_700_100_000_000,
    eventTimestampMs: 1_700_000_000_500,
    transferredToAppUserIds: [],
    transferredFromAppUserIds: [],
    ...overrides,
  };
}

describe('mapEventToDeltas', () => {
  const expiresIso = new Date(1_700_100_000_000).toISOString();

  it.each([
    RevenueCatEventType.INITIAL_PURCHASE,
    RevenueCatEventType.RENEWAL,
    RevenueCatEventType.UNCANCELLATION,
    RevenueCatEventType.PRODUCT_CHANGE,
  ])('activates the entitlement on %s', (type) => {
    const deltas = mapEventToDeltas(event({ type }));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      userId: 'user-1',
      entitlementKey: 'CLEANER_PRO',
      active: true,
      expiresAt: expiresIso,
      store: 'app_store',
    });
  });

  it('keeps the entitlement active on CANCELLATION (not immediate loss)', () => {
    const deltas = mapEventToDeltas(event({ type: RevenueCatEventType.CANCELLATION }));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.active).toBe(true);
  });

  it.each([RevenueCatEventType.BILLING_ISSUE, RevenueCatEventType.SUBSCRIPTION_PAUSED])(
    'keeps the entitlement active until expiry on %s (reconciliation is arbiter)',
    (type) => {
      const deltas = mapEventToDeltas(event({ type }));
      expect(deltas).toHaveLength(1);
      expect(deltas[0]?.active).toBe(true);
    },
  );

  it('deactivates the entitlement on EXPIRATION', () => {
    const deltas = mapEventToDeltas(event({ type: RevenueCatEventType.EXPIRATION }));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.active).toBe(false);
  });

  it('produces a source+destination pair on TRANSFER', () => {
    const deltas = mapEventToDeltas(
      event({
        type: RevenueCatEventType.TRANSFER,
        appUserId: null,
        entitlementIds: ['host_pro'],
        transferredFromAppUserIds: ['old-user'],
        transferredToAppUserIds: ['new-user'],
      }),
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      userId: 'old-user',
      transferToUserId: 'new-user',
      entitlementKey: 'HOST_PRO',
      active: false,
    });
  });

  it('yields no deltas for an unknown event type', () => {
    expect(mapEventToDeltas(event({ type: 'SOME_FUTURE_EVENT' }))).toEqual([]);
  });

  it('yields no deltas when no recognized entitlement is present', () => {
    expect(mapEventToDeltas(event({ entitlementIds: ['unknown_entitlement'] }))).toEqual([]);
  });

  it('yields no deltas for a non-transfer event without an app_user_id', () => {
    expect(mapEventToDeltas(event({ type: RevenueCatEventType.RENEWAL, appUserId: null }))).toEqual([]);
  });

  it('ignores unmapped entitlements but keeps recognized ones', () => {
    const deltas = mapEventToDeltas(event({ entitlementIds: ['cleaner_pro', 'unknown'] }));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.entitlementKey).toBe('CLEANER_PRO');
  });
});

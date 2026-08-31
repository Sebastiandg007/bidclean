import { sanitizeRevenueCatEvent } from '../revenuecat/revenuecat-payload.sanitizer';

/**
 * Unit tests for the RevenueCat payload sanitizer.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 2.4, P9 (no sensitive persistence — strict whitelist).
 */
describe('sanitizeRevenueCatEvent', () => {
  it('whitelists only safe fields and drops everything else', () => {
    const raw = {
      api_version: '1.0',
      event: {
        id: 'evt_1',
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user-1',
        original_app_user_id: 'user-1',
        product_id: 'cleaner_pro_monthly',
        entitlement_ids: ['cleaner_pro'],
        store: 'app_store',
        environment: 'PRODUCTION',
        period_type: 'NORMAL',
        purchased_at_ms: 1_700_000_000_000,
        expiration_at_ms: 1_700_100_000_000,
        event_timestamp_ms: 1_700_000_000_500,
        // sensitive fields that must NOT survive:
        original_transaction_id: 'secret-txn',
        transaction_id: 'secret-txn-2',
        app_id: 'app-secret',
        subscriber_attributes: { email: 'user@example.com' },
        aliases: ['user@example.com'],
        fetch_token: 'super-secret-receipt-token',
      },
    };

    const result = sanitizeRevenueCatEvent(raw);

    expect(result).toEqual({
      eventId: 'evt_1',
      type: 'INITIAL_PURCHASE',
      appUserId: 'user-1',
      originalAppUserId: 'user-1',
      productId: 'cleaner_pro_monthly',
      entitlementIds: ['cleaner_pro'],
      store: 'app_store',
      environment: 'PRODUCTION',
      periodType: 'NORMAL',
      purchasedAtMs: 1_700_000_000_000,
      expirationAtMs: 1_700_100_000_000,
      eventTimestampMs: 1_700_000_000_500,
      transferredToAppUserIds: [],
      transferredFromAppUserIds: [],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-txn');
    expect(serialized).not.toContain('super-secret-receipt-token');
    expect(serialized).not.toContain('user@example.com');
  });

  it('captures transfer source/destination arrays', () => {
    const result = sanitizeRevenueCatEvent({
      event: {
        id: 'evt_t',
        type: 'TRANSFER',
        entitlement_ids: ['host_pro'],
        transferred_from: ['old-user'],
        transferred_to: ['new-user'],
        event_timestamp_ms: 1_700_000_000_000,
      },
    });
    expect(result.transferredFromAppUserIds).toEqual(['old-user']);
    expect(result.transferredToAppUserIds).toEqual(['new-user']);
  });

  it('never throws on malformed input, yielding null/empty defaults', () => {
    for (const bad of [null, undefined, 42, 'string', {}, { event: null }, { event: 'x' }]) {
      const result = sanitizeRevenueCatEvent(bad);
      expect(result.eventId).toBeNull();
      expect(result.entitlementIds).toEqual([]);
      expect(result.transferredToAppUserIds).toEqual([]);
    }
  });

  it('drops non-string entitlement ids', () => {
    const result = sanitizeRevenueCatEvent({
      event: { id: 'e', type: 'RENEWAL', entitlement_ids: ['cleaner_pro', 42, null, 'host_pro'] },
    });
    expect(result.entitlementIds).toEqual(['cleaner_pro', 'host_pro']);
  });
});

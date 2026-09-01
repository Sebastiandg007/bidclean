/**
 * Unit tests for the useSubscription Zustand store.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 5.2, 5.4, 6.4 (customerInfo -> entitlements; purchase/restore;
 * refresh /subscriptions/me on purchase; client never authoritative).
 *
 * The RevenueCat SDK is mocked in src/__mocks__/setup.ts; the API client is mocked here.
 */

import Purchases from 'react-native-purchases';
import { useSubscriptionStore } from '../useSubscription';
import { fetchMyEntitlementsRequest } from '../subscriptions.api';
import { EntitlementKey, SubscriberTier } from '../subscriptions.types';

jest.mock('../subscriptions.api', () => ({
  fetchMyEntitlementsRequest: jest.fn(),
}));

const mockedPurchases = Purchases as jest.Mocked<typeof Purchases>;
const mockedFetch = fetchMyEntitlementsRequest as jest.MockedFunction<typeof fetchMyEntitlementsRequest>;

const SERVER_VIEW = {
  tier: SubscriberTier.PRO,
  roleTiers: { HOST: SubscriberTier.FREE, CLEANER: SubscriberTier.PRO },
  entitlements: [{ key: EntitlementKey.CLEANER_PRO, active: true, expiresAt: null, store: 'app_store' }],
};

function customerInfoWith(activeIds: string[]) {
  const active: Record<string, unknown> = {};
  for (const id of activeIds) {
    active[id] = { identifier: id };
  }
  return { entitlements: { active } } as never;
}

describe('useSubscriptionStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSubscriptionStore.getState().reset();
    mockedFetch.mockResolvedValue(SERVER_VIEW);
  });

  it('configures the SDK and derives client entitlements from customerInfo', async () => {
    mockedPurchases.getCustomerInfo.mockResolvedValue(customerInfoWith(['cleaner_pro']));

    await useSubscriptionStore.getState().configure('user-uuid-1');

    const state = useSubscriptionStore.getState();
    expect(mockedPurchases.configure).toHaveBeenCalledWith(
      expect.objectContaining({ appUserID: 'user-uuid-1' }),
    );
    expect(state.isConfigured).toBe(true);
    expect(state.clientEntitlements.has(EntitlementKey.CLEANER_PRO)).toBe(true);
    expect(mockedFetch).toHaveBeenCalledTimes(1); // converges to server view
    expect(state.serverView).toEqual(SERVER_VIEW);
  });

  it('refreshes the server view after a successful purchase (converges the window)', async () => {
    mockedPurchases.purchasePackage.mockResolvedValue({
      customerInfo: customerInfoWith(['cleaner_pro']),
    } as never);

    const result = await useSubscriptionStore.getState().purchase({ identifier: 'pkg' } as never);

    expect(result.success).toBe(true);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(useSubscriptionStore.getState().serverView).toEqual(SERVER_VIEW);
  });

  it('maps a user-cancelled purchase to the cancellation i18n key', async () => {
    mockedPurchases.purchasePackage.mockRejectedValue({ userCancelled: true });

    const result = await useSubscriptionStore.getState().purchase({ identifier: 'pkg' } as never);

    expect(result.success).toBe(false);
    expect(result.errorKey).toBe('subscriptions.error.purchase_cancelled');
    expect(mockedFetch).not.toHaveBeenCalled(); // no convergence on a failed purchase
  });

  it('maps a generic purchase failure to the failure i18n key', async () => {
    mockedPurchases.purchasePackage.mockRejectedValue(new Error('boom'));

    const result = await useSubscriptionStore.getState().purchase({ identifier: 'pkg' } as never);

    expect(result.errorKey).toBe('subscriptions.error.purchase_failed');
  });

  it('restores purchases and refreshes the server view', async () => {
    mockedPurchases.restorePurchases.mockResolvedValue(customerInfoWith(['host_pro']));

    const result = await useSubscriptionStore.getState().restore();

    expect(result.success).toBe(true);
    expect(useSubscriptionStore.getState().clientEntitlements.has(EntitlementKey.HOST_PRO)).toBe(true);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('never grants entitlements locally — the server view drives access', async () => {
    // Even with an empty client set, the server view remains the authority for access.
    mockedPurchases.getCustomerInfo.mockResolvedValue(customerInfoWith([]));
    await useSubscriptionStore.getState().configure('user-uuid-1');

    const state = useSubscriptionStore.getState();
    expect(state.clientEntitlements.size).toBe(0);
    expect(state.serverView?.tier).toBe(SubscriberTier.PRO); // server is authoritative
  });

  it('sets an error key when the server refresh fails', async () => {
    mockedFetch.mockRejectedValue(new Error('network'));

    await useSubscriptionStore.getState().refreshServerView();

    expect(useSubscriptionStore.getState().error).toBe('subscriptions.error.fetch_status_failed');
  });
});

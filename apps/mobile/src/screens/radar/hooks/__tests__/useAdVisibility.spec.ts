/**
 * Unit tests for useAdVisibility.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 5.5, 1.8 (ad slots reflect the REAL ad_free entitlement; ad_free is
 * independent of PRO; safe fallback shows ads until the server view loads).
 */

import { renderHook } from '@testing-library/react-native';

import { useAdVisibility } from '../useAdVisibility';
import { useSubscriptionStore } from '../../../subscriptions/useSubscription';
import { EntitlementKey, SubscriberTier } from '../../../subscriptions/subscriptions.types';

function viewWithEntitlements(active: EntitlementKey[]): void {
  useSubscriptionStore.setState({
    isLoading: false,
    serverView: {
      tier: SubscriberTier.FREE,
      roleTiers: { HOST: SubscriberTier.FREE, CLEANER: SubscriberTier.FREE },
      entitlements: active.map((key) => ({ key, active: true, expiresAt: null, store: 'app_store' })),
    },
  });
}

describe('useAdVisibility', () => {
  afterEach(() => useSubscriptionStore.getState().reset());

  it('shows ads (default) while the server view has not loaded', () => {
    useSubscriptionStore.setState({ serverView: null });
    const { result } = renderHook(() => useAdVisibility());
    expect(result.current.adsEnabled).toBe(true);
  });

  it('hides ads when the ad_free entitlement is active', () => {
    viewWithEntitlements([EntitlementKey.AD_FREE]);
    const { result } = renderHook(() => useAdVisibility());
    expect(result.current.adsEnabled).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('shows ads when ad_free is absent, even if the user holds cleaner_pro (ad_free != PRO)', () => {
    viewWithEntitlements([EntitlementKey.CLEANER_PRO]);
    const { result } = renderHook(() => useAdVisibility());
    expect(result.current.adsEnabled).toBe(true);
  });

  it('shows ads for a fully FREE user', () => {
    viewWithEntitlements([]);
    const { result } = renderHook(() => useAdVisibility());
    expect(result.current.adsEnabled).toBe(true);
  });
});

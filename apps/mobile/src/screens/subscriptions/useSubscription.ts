/**
 * useSubscription — Zustand store for the RevenueCat subscription flow.
 *
 * Configures the RevenueCat SDK with the internal user UUID as `app_user_id` and the platform
 * public key, derives active entitlements from `customerInfo` for instant UI, and exposes
 * purchase/restore. The client is a UI convenience only: after any purchase or `customerInfo`
 * change it refreshes `GET /subscriptions/me` so the app converges to the server-authoritative
 * mirror. It NEVER grants entitlements locally. Errors map to i18n keys.
 */

import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';
import { create } from 'zustand';

import { fetchMyEntitlementsRequest } from './subscriptions.api';
import {
  RC_ANDROID_API_KEY,
  RC_ENTITLEMENT_IDS,
  RC_IOS_API_KEY,
  SUBSCRIPTIONS_I18N_KEYS,
} from './subscriptions.constants';
import {
  EntitlementKey,
  type PurchaseResult,
  type SubscriptionView,
} from './subscriptions.types';

/** Active RevenueCat entitlement ids, derived from customerInfo (UI convenience only). */
function activeEntitlementKeys(info: CustomerInfo): Set<EntitlementKey> {
  const active = new Set<EntitlementKey>();
  const activeIds = info.entitlements.active;
  for (const key of Object.keys(RC_ENTITLEMENT_IDS) as EntitlementKey[]) {
    if (RC_ENTITLEMENT_IDS[key] in activeIds) {
      active.add(key);
    }
  }
  return active;
}

/** Map a RevenueCat purchase error to a specific i18n key. */
function purchaseErrorKey(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'userCancelled' in error) {
    if ((error as { userCancelled?: boolean }).userCancelled) {
      return SUBSCRIPTIONS_I18N_KEYS.ERROR_PURCHASE_CANCELLED;
    }
  }
  return SUBSCRIPTIONS_I18N_KEYS.ERROR_PURCHASE_FAILED;
}

export interface SubscriptionState {
  /** SDK-derived active entitlements (UI convenience; not authoritative). */
  clientEntitlements: Set<EntitlementKey>;
  /** Server-authoritative view from the backend mirror. */
  serverView: SubscriptionView | null;
  isConfigured: boolean;
  isSubmitting: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface SubscriptionActions {
  /** Configure the SDK with the internal UUID and refresh the server view. */
  configure: (appUserId: string) => Promise<void>;
  /** Purchase a package; converges to the server mirror afterward. */
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseResult>;
  /** Restore purchases (recover entitlements on a new device). */
  restore: () => Promise<PurchaseResult>;
  /** Refresh the server-authoritative view from the backend. */
  refreshServerView: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export type SubscriptionStore = SubscriptionState & SubscriptionActions;

const initialState: SubscriptionState = {
  clientEntitlements: new Set(),
  serverView: null,
  isConfigured: false,
  isSubmitting: false,
  isLoading: false,
  error: null,
};

/** The platform public SDK key (iOS/Android). Server secret keys are never shipped. */
function platformApiKey(): string {
  return Platform.OS === 'ios' ? RC_IOS_API_KEY : RC_ANDROID_API_KEY;
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  ...initialState,

  configure: async (appUserId) => {
    Purchases.configure({ apiKey: platformApiKey(), appUserID: appUserId });
    set({ isConfigured: true });
    try {
      const info = await Purchases.getCustomerInfo();
      set({ clientEntitlements: activeEntitlementKeys(info) });
    } catch {
      // customerInfo is UI-only; a failure never blocks — the server view is authoritative.
      set({ clientEntitlements: new Set() });
    }
    await get().refreshServerView();
  },

  purchase: async (pkg) => {
    set({ isSubmitting: true, error: null });
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      set({ clientEntitlements: activeEntitlementKeys(customerInfo), isSubmitting: false });
      // Converge to the server-authoritative mirror (resolves the purchase->mirror window).
      await get().refreshServerView();
      return { success: true };
    } catch (error) {
      const errorKey = purchaseErrorKey(error);
      set({ isSubmitting: false, error: errorKey });
      return { success: false, errorKey };
    }
  },

  restore: async () => {
    set({ isSubmitting: true, error: null });
    try {
      const info = await Purchases.restorePurchases();
      set({ clientEntitlements: activeEntitlementKeys(info), isSubmitting: false });
      await get().refreshServerView();
      return { success: true };
    } catch {
      set({ isSubmitting: false, error: SUBSCRIPTIONS_I18N_KEYS.ERROR_RESTORE_FAILED });
      return { success: false, errorKey: SUBSCRIPTIONS_I18N_KEYS.ERROR_RESTORE_FAILED };
    }
  },

  refreshServerView: async () => {
    set({ isLoading: true });
    try {
      const serverView = await fetchMyEntitlementsRequest();
      set({ serverView, isLoading: false });
    } catch {
      set({ isLoading: false, error: SUBSCRIPTIONS_I18N_KEYS.ERROR_FETCH_STATUS });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set({ ...initialState, clientEntitlements: new Set() }),
}));

/** Convenience hook returning the full subscription store. */
export function useSubscription(): SubscriptionStore {
  return useSubscriptionStore();
}

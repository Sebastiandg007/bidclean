/**
 * usePayments — Zustand store for the Stripe escrow flow.
 *
 * Host side: view payment status, request full/partial refunds.
 * Cleaner side: start payout onboarding, read account status (payout gate banner).
 *
 * The backend is authoritative — the client never decides payment state. Refunds
 * attach an Idempotency-Key (handled in the api layer). Errors map to i18n keys.
 */

import { create } from 'zustand';

import {
  startOnboardingRequest,
  fetchAccountStatusRequest,
  fetchPaymentRequest,
  requestRefundRequest,
} from './payments.api';
import { PAYMENTS_ERROR_KEYS } from './payments.constants';
import type {
  OnboardingResult,
  PaymentView,
  RefundResult,
  StripeAccountStatus,
} from './payments.types';

interface HttpErrorLike {
  response?: { status?: number };
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    return (err as HttpErrorLike).response?.status;
  }
  return undefined;
}

/** Map a refund error to a specific i18n key (409 blocked, 422 ceiling, else generic). */
function refundErrorKey(err: unknown): string {
  const status = statusOf(err);
  if (status === 409) {
    return PAYMENTS_ERROR_KEYS.REFUND_BLOCKED;
  }
  if (status === 422) {
    return PAYMENTS_ERROR_KEYS.REFUND_CEILING;
  }
  return PAYMENTS_ERROR_KEYS.REFUND;
}

export interface PaymentsState {
  /** Payments keyed by offerId */
  paymentByOffer: Map<string, PaymentView>;
  accountStatus: StripeAccountStatus | null;
  isSubmitting: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface PaymentsActions {
  fetchPayment: (offerId: string) => Promise<void>;
  requestRefund: (offerId: string, amountCents?: number) => Promise<RefundResult>;
  refreshAccountStatus: () => Promise<void>;
  startOnboarding: () => Promise<OnboardingResult | null>;
  /** Whether the Cleaner still needs onboarding (drives the payout banner). */
  needsPayoutOnboarding: () => boolean;
  clearError: () => void;
  reset: () => void;
}

export type PaymentsStore = PaymentsState & PaymentsActions;

const initialState: PaymentsState = {
  paymentByOffer: new Map(),
  accountStatus: null,
  isSubmitting: false,
  isLoading: false,
  error: null,
};

export const usePaymentsStore = create<PaymentsStore>((set, get) => ({
  ...initialState,

  fetchPayment: async (offerId) => {
    set({ isLoading: true, error: null });
    try {
      const payment = await fetchPaymentRequest(offerId);
      const updated = new Map(get().paymentByOffer);
      updated.set(offerId, payment);
      set({ paymentByOffer: updated, isLoading: false });
    } catch {
      set({ isLoading: false, error: PAYMENTS_ERROR_KEYS.FETCH_PAYMENT });
    }
  },

  requestRefund: async (offerId, amountCents) => {
    set({ isSubmitting: true, error: null });
    try {
      // Omit amount entirely for a full refund (server treats undefined as full).
      const payload = amountCents === undefined ? {} : { amountCents };
      const payment = await requestRefundRequest(offerId, payload);
      const updated = new Map(get().paymentByOffer);
      updated.set(offerId, payment);
      set({ paymentByOffer: updated, isSubmitting: false });
      return { success: true, payment };
    } catch (err) {
      const errorKey = refundErrorKey(err);
      set({ isSubmitting: false, error: errorKey });
      return { success: false, errorKey };
    }
  },

  refreshAccountStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const accountStatus = await fetchAccountStatusRequest();
      set({ accountStatus, isLoading: false });
    } catch {
      set({ isLoading: false, error: PAYMENTS_ERROR_KEYS.ACCOUNT_STATUS });
    }
  },

  startOnboarding: async () => {
    set({ isSubmitting: true, error: null });
    try {
      const result = await startOnboardingRequest();
      set({ isSubmitting: false });
      return result;
    } catch {
      set({ isSubmitting: false, error: PAYMENTS_ERROR_KEYS.ONBOARDING });
      return null;
    }
  },

  needsPayoutOnboarding: () => {
    const status = get().accountStatus;
    // No account, or account exists but payouts are not yet enabled.
    return status === null || status.payoutsEnabled === false;
  },

  clearError: () => set({ error: null }),

  reset: () => set({ ...initialState, paymentByOffer: new Map() }),
}));

/** Convenience hook returning the full payments store. */
export function usePayments(): PaymentsStore {
  return usePaymentsStore();
}

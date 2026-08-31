/**
 * Unit tests for usePaymentsStore.
 *
 * Feature: stripe-escrow
 * Covers: fetch payment, idempotent refund request (full/partial), refund error
 * mapping (blocked/ceiling), payout-gate flag, server-authoritative state.
 */

import { usePaymentsStore } from '../usePayments';
import { PAYMENTS_ERROR_KEYS } from '../payments.constants';
import type { PaymentView, StripeAccountStatus } from '../payments.types';

jest.mock('../payments.api', () => ({
  startOnboardingRequest: jest.fn(),
  fetchAccountStatusRequest: jest.fn(),
  fetchPaymentRequest: jest.fn(),
  requestRefundRequest: jest.fn(),
}));

import * as api from '../payments.api';

const mockedApi = api as jest.Mocked<typeof api>;

function makePayment(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    id: 'pay-1',
    offerId: 'offer-1',
    paymentStatus: 'HELD',
    disputeStatus: 'NONE',
    payoutStatus: 'NOT_READY',
    breakdown: {
      agreedPriceCents: 10000,
      hostTotalCents: 11000,
      cleanerPayoutCents: 9700,
      platformGrossRevenueCents: 1300,
      stripeFeeCents: 320,
      netPlatformRevenueCents: 980,
      refundedAmountCents: 0,
      reversedAmountCents: 0,
      currency: 'USD',
    },
    heldAt: null,
    releasedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function httpError(status: number): Error & { response: { status: number } } {
  const err = new Error(`HTTP ${status}`) as Error & { response: { status: number } };
  err.response = { status };
  return err;
}

describe('usePaymentsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePaymentsStore.getState().reset();
  });

  it('fetches and stores a payment by offer', async () => {
    mockedApi.fetchPaymentRequest.mockResolvedValue(makePayment());
    await usePaymentsStore.getState().fetchPayment('offer-1');
    expect(usePaymentsStore.getState().paymentByOffer.get('offer-1')?.id).toBe('pay-1');
  });

  it('requests a full refund by omitting the amount (idempotent server contract)', async () => {
    mockedApi.requestRefundRequest.mockResolvedValue(makePayment({ paymentStatus: 'REFUNDED' }));
    const result = await usePaymentsStore.getState().requestRefund('offer-1');
    expect(mockedApi.requestRefundRequest).toHaveBeenCalledWith('offer-1', {});
    expect(result.success).toBe(true);
    expect(usePaymentsStore.getState().paymentByOffer.get('offer-1')?.paymentStatus).toBe(
      'REFUNDED',
    );
  });

  it('requests a partial refund with an explicit amount', async () => {
    mockedApi.requestRefundRequest.mockResolvedValue(
      makePayment({ paymentStatus: 'PARTIALLY_REFUNDED' }),
    );
    await usePaymentsStore.getState().requestRefund('offer-1', 5000);
    expect(mockedApi.requestRefundRequest).toHaveBeenCalledWith('offer-1', { amountCents: 5000 });
  });

  it('maps a 409 refund error to the blocked key', async () => {
    mockedApi.requestRefundRequest.mockRejectedValue(httpError(409));
    const result = await usePaymentsStore.getState().requestRefund('offer-1');
    expect(result.success).toBe(false);
    expect(result.errorKey).toBe(PAYMENTS_ERROR_KEYS.REFUND_BLOCKED);
  });

  it('maps a 422 refund error to the ceiling key', async () => {
    mockedApi.requestRefundRequest.mockRejectedValue(httpError(422));
    const result = await usePaymentsStore.getState().requestRefund('offer-1', 999999);
    expect(result.errorKey).toBe(PAYMENTS_ERROR_KEYS.REFUND_CEILING);
  });

  it('drives the payout-gate flag from account status', async () => {
    const notEnabled: StripeAccountStatus = {
      hasAccount: true,
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      country: 'US',
      defaultCurrency: 'usd',
    };
    mockedApi.fetchAccountStatusRequest.mockResolvedValue(notEnabled);
    await usePaymentsStore.getState().refreshAccountStatus();
    expect(usePaymentsStore.getState().needsPayoutOnboarding()).toBe(true);

    mockedApi.fetchAccountStatusRequest.mockResolvedValue({ ...notEnabled, payoutsEnabled: true });
    await usePaymentsStore.getState().refreshAccountStatus();
    expect(usePaymentsStore.getState().needsPayoutOnboarding()).toBe(false);
  });

  it('treats a missing account as needing onboarding', () => {
    expect(usePaymentsStore.getState().needsPayoutOnboarding()).toBe(true);
  });

  it('returns the onboarding url on success', async () => {
    mockedApi.startOnboardingRequest.mockResolvedValue({ onboardingUrl: 'https://connect/x' });
    const result = await usePaymentsStore.getState().startOnboarding();
    expect(result?.onboardingUrl).toBe('https://connect/x');
  });

  it('is server-authoritative: does not derive payment state locally', async () => {
    mockedApi.fetchPaymentRequest.mockResolvedValue(makePayment({ payoutStatus: 'PAID' }));
    await usePaymentsStore.getState().fetchPayment('offer-1');
    // The store only mirrors what the server returned.
    expect(usePaymentsStore.getState().paymentByOffer.get('offer-1')?.payoutStatus).toBe('PAID');
  });
});

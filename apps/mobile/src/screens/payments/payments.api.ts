/**
 * Payments API client.
 *
 * Typed HTTP methods for the payment endpoints. Uses the shared apiClient (lazy
 * import to avoid circular deps) and attaches a cryptographically-random
 * Idempotency-Key to the refund mutation via expo-crypto.
 */

import * as Crypto from 'expo-crypto';
import type { AxiosInstance } from 'axios';

import { PAYMENTS_ENDPOINTS, IDEMPOTENCY_HEADER } from './payments.constants';
import type { OnboardingResult, PaymentView, StripeAccountStatus } from './payments.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Generate a cryptographically random idempotency key using expo-crypto. */
async function generateIdempotencyKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function idempotencyHeaders(): Promise<{ headers: Record<string, string> }> {
  const key = await generateIdempotencyKey();
  return { headers: { [IDEMPOTENCY_HEADER]: key } };
}

/** Refund body (omit amount for a full refund). */
export interface RefundPayload {
  amountCents?: number;
}

/** Start (or resume) Cleaner payout onboarding. */
export async function startOnboardingRequest(): Promise<OnboardingResult> {
  const client = await getApiClient();
  const response = await client.post<OnboardingResult>(PAYMENTS_ENDPOINTS.ONBOARDING, {});
  return response.data;
}

/** Fetch the Cleaner's Connected Account status. */
export async function fetchAccountStatusRequest(): Promise<StripeAccountStatus> {
  const client = await getApiClient();
  const response = await client.get<StripeAccountStatus>(PAYMENTS_ENDPOINTS.ACCOUNT_STATUS);
  return response.data;
}

/** Fetch the payment for an offer (Host owner or matched Cleaner). */
export async function fetchPaymentRequest(offerId: string): Promise<PaymentView> {
  const client = await getApiClient();
  const response = await client.get<PaymentView>(PAYMENTS_ENDPOINTS.PAYMENT_FOR_OFFER(offerId));
  return response.data;
}

/** Request a full or partial refund (Host owner). Attaches an Idempotency-Key. */
export async function requestRefundRequest(
  offerId: string,
  payload: RefundPayload,
): Promise<PaymentView> {
  const client = await getApiClient();
  const response = await client.post<PaymentView>(
    PAYMENTS_ENDPOINTS.REFUND(offerId),
    payload,
    await idempotencyHeaders(),
  );
  return response.data;
}

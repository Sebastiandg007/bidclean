/**
 * Negotiation API client.
 *
 * Typed HTTP methods for the negotiation endpoints. Uses the shared apiClient
 * (lazy import to avoid circular deps) and attaches a cryptographically-random
 * Idempotency-Key to every mutation via expo-crypto.
 */

import * as Crypto from 'expo-crypto';
import type { AxiosInstance } from 'axios';

import {
  NEGOTIATION_ENDPOINTS,
  IDEMPOTENCY_HEADER,
} from './negotiation.constants';
import type {
  ThreadView,
  ProposalView,
  MatchSummary,
  HostInboxItem,
} from './negotiation.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Generate a cryptographically random idempotency key using expo-crypto */
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

// ─── Request Types ───────────────────────────────────────────────────────────

export interface CounterofferPayload {
  proposedPriceCents: number;
}

// ─── API Methods ─────────────────────────────────────────────────────────────

/** Cleaner directly accepts an offer at the Host's price. */
export async function acceptOfferRequest(offerId: string): Promise<MatchSummary> {
  const client = await getApiClient();
  const response = await client.post<MatchSummary>(
    NEGOTIATION_ENDPOINTS.ACCEPT_OFFER(offerId),
    {},
    await idempotencyHeaders(),
  );
  return response.data;
}

/** Cleaner submits a counteroffer for an offer. */
export async function createCounterofferRequest(
  offerId: string,
  payload: CounterofferPayload,
): Promise<ProposalView> {
  const client = await getApiClient();
  const response = await client.post<ProposalView>(
    NEGOTIATION_ENDPOINTS.COUNTEROFFERS(offerId),
    payload,
    await idempotencyHeaders(),
  );
  return response.data;
}

/** Accept the counterparty's PENDING proposal (Host accepts Cleaner, or Cleaner accepts Host counter-back). */
export async function acceptProposalRequest(proposalId: string): Promise<MatchSummary> {
  const client = await getApiClient();
  const response = await client.post<MatchSummary>(
    NEGOTIATION_ENDPOINTS.ACCEPT_PROPOSAL(proposalId),
    {},
    await idempotencyHeaders(),
  );
  return response.data;
}

/** Reject the counterparty's PENDING proposal. */
export async function rejectProposalRequest(proposalId: string): Promise<ProposalView> {
  const client = await getApiClient();
  const response = await client.post<ProposalView>(
    NEGOTIATION_ENDPOINTS.REJECT_PROPOSAL(proposalId),
    {},
    await idempotencyHeaders(),
  );
  return response.data;
}

/** Counter back with a new price. */
export async function counterProposalRequest(
  proposalId: string,
  payload: CounterofferPayload,
): Promise<ProposalView> {
  const client = await getApiClient();
  const response = await client.post<ProposalView>(
    NEGOTIATION_ENDPOINTS.COUNTER_PROPOSAL(proposalId),
    payload,
    await idempotencyHeaders(),
  );
  return response.data;
}

/** Fetch the Cleaner's own thread for an offer. */
export async function fetchThreadRequest(offerId: string): Promise<ThreadView | null> {
  const client = await getApiClient();
  const response = await client.get<ThreadView | null>(
    NEGOTIATION_ENDPOINTS.THREAD(offerId),
  );
  return response.data;
}

/** Fetch the Host's counteroffer inbox. */
export async function fetchHostInboxRequest(): Promise<HostInboxItem[]> {
  const client = await getApiClient();
  const response = await client.get<HostInboxItem[]>(NEGOTIATION_ENDPOINTS.HOST_INBOX);
  return response.data;
}

/**
 * useNegotiation — Zustand store for the offer negotiation flow.
 *
 * Cleaner side: direct accept, submit counteroffer, accept/decline Host counter-back.
 * Host side: fetch inbox, accept/reject/counter Cleaner proposals.
 * Real-time: version/sequence-gated event handling with eventId dedup.
 *
 * The backend is authoritative; client-side deviation bounds and payout preview
 * are for UX only. All mutations use idempotency keys (handled in the api layer).
 */

import { create } from 'zustand';

import {
  acceptOfferRequest,
  createCounterofferRequest,
  acceptProposalRequest,
  rejectProposalRequest,
  counterProposalRequest,
  fetchThreadRequest,
  fetchHostInboxRequest,
} from './negotiation.api';
import {
  NEGOTIATION_ERROR_KEYS,
  getDeviationRange,
  isWithinDeviationBounds,
} from './negotiation.constants';
import type {
  ThreadView,
  HostInboxItem,
  AcceptResult,
  Breakdown,
  NegotiationEvent,
} from './negotiation.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BPS_DIVISOR = 10000;

interface HttpErrorLike {
  response?: { status?: number };
}

/** Whether an error is an HTTP 409 (offer/proposal no longer available). */
function isConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as HttpErrorLike).response?.status === 409
  );
}

function extractErrorKey(err: unknown, fallbackKey: string): string {
  if (isConflict(err)) {
    return NEGOTIATION_ERROR_KEYS.OFFER_UNAVAILABLE;
  }
  return fallbackKey;
}

// ─── State ───────────────────────────────────────────────────────────────────

export interface NegotiationState {
  /** Cleaner-side threads keyed by offerId */
  myThreads: Map<string, ThreadView>;
  /** Host-side inbox of pending Cleaner counteroffers */
  inbox: HostInboxItem[];
  /** Processed event IDs for real-time dedup */
  processedEventIds: Set<string>;
  isSubmitting: boolean;
  isLoadingInbox: boolean;
  error: string | null;
}

export interface NegotiationActions {
  // Cleaner side
  acceptOffer: (offerId: string) => Promise<AcceptResult>;
  submitCounteroffer: (offerId: string, priceCents: number) => Promise<boolean>;
  acceptHostCounter: (proposalId: string) => Promise<AcceptResult>;
  declineHostCounter: (proposalId: string) => Promise<boolean>;
  fetchThread: (offerId: string) => Promise<void>;

  // Host side
  fetchInbox: () => Promise<void>;
  acceptCounteroffer: (proposalId: string) => Promise<AcceptResult>;
  rejectCounteroffer: (proposalId: string) => Promise<boolean>;
  counterBack: (proposalId: string, priceCents: number) => Promise<boolean>;

  // Real-time
  handleNegotiationEvent: (event: NegotiationEvent) => void;

  // Derived preview (server authoritative)
  computePreviewPayout: (
    priceCents: number,
    hostFeeRateBps: number,
    cleanerRateBps: number,
    currency: string,
  ) => Breakdown;
  isWithinBounds: (basePriceCents: number, priceCents: number) => boolean;

  clearError: () => void;
  reset: () => void;
}

export type NegotiationStore = NegotiationState & NegotiationActions;

const initialState: NegotiationState = {
  myThreads: new Map(),
  inbox: [],
  processedEventIds: new Set(),
  isSubmitting: false,
  isLoadingInbox: false,
  error: null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useNegotiationStore = create<NegotiationStore>((set, get) => ({
  ...initialState,

  // ─── Cleaner side ──────────────────────────────────────────────────────────

  acceptOffer: async (offerId) => {
    set({ isSubmitting: true, error: null });
    try {
      const match = await acceptOfferRequest(offerId);
      set({ isSubmitting: false });
      return { success: true, match };
    } catch (err) {
      const errorKey = extractErrorKey(err, NEGOTIATION_ERROR_KEYS.ACCEPT);
      set({ isSubmitting: false, error: errorKey });
      return { success: false, errorKey };
    }
  },

  submitCounteroffer: async (offerId, priceCents) => {
    set({ isSubmitting: true, error: null });
    try {
      const proposal = await createCounterofferRequest(offerId, { proposedPriceCents: priceCents });
      // Refresh the thread so the UI reflects the new PENDING proposal
      const thread = await fetchThreadRequest(offerId);
      if (thread) {
        const updated = new Map(get().myThreads);
        updated.set(offerId, thread);
        set({ myThreads: updated });
      }
      set({ isSubmitting: false });
      return proposal !== null;
    } catch (err) {
      set({
        isSubmitting: false,
        error: extractErrorKey(err, NEGOTIATION_ERROR_KEYS.COUNTEROFFER),
      });
      return false;
    }
  },

  acceptHostCounter: async (proposalId) => {
    set({ isSubmitting: true, error: null });
    try {
      const match = await acceptProposalRequest(proposalId);
      set({ isSubmitting: false });
      return { success: true, match };
    } catch (err) {
      const errorKey = extractErrorKey(err, NEGOTIATION_ERROR_KEYS.ACCEPT);
      set({ isSubmitting: false, error: errorKey });
      return { success: false, errorKey };
    }
  },

  declineHostCounter: async (proposalId) => {
    set({ isSubmitting: true, error: null });
    try {
      await rejectProposalRequest(proposalId);
      set({ isSubmitting: false });
      return true;
    } catch (err) {
      set({ isSubmitting: false, error: extractErrorKey(err, NEGOTIATION_ERROR_KEYS.REJECT) });
      return false;
    }
  },

  fetchThread: async (offerId) => {
    try {
      const thread = await fetchThreadRequest(offerId);
      const updated = new Map(get().myThreads);
      if (thread) {
        updated.set(offerId, thread);
      } else {
        updated.delete(offerId);
      }
      set({ myThreads: updated });
    } catch (err) {
      set({ error: extractErrorKey(err, NEGOTIATION_ERROR_KEYS.FETCH_THREAD) });
    }
  },

  // ─── Host side ─────────────────────────────────────────────────────────────

  fetchInbox: async () => {
    set({ isLoadingInbox: true, error: null });
    try {
      const inbox = await fetchHostInboxRequest();
      set({ inbox, isLoadingInbox: false });
    } catch (err) {
      set({
        isLoadingInbox: false,
        error: extractErrorKey(err, NEGOTIATION_ERROR_KEYS.FETCH_INBOX),
      });
    }
  },

  acceptCounteroffer: async (proposalId) => {
    set({ isSubmitting: true, error: null });
    try {
      const match = await acceptProposalRequest(proposalId);
      // Remove all inbox items for the matched offer
      set((prev) => ({
        isSubmitting: false,
        inbox: prev.inbox.filter((item) => item.offerId !== match.offerId),
      }));
      return { success: true, match };
    } catch (err) {
      const errorKey = extractErrorKey(err, NEGOTIATION_ERROR_KEYS.ACCEPT);
      set({ isSubmitting: false, error: errorKey });
      return { success: false, errorKey };
    }
  },

  rejectCounteroffer: async (proposalId) => {
    set({ isSubmitting: true, error: null });
    try {
      await rejectProposalRequest(proposalId);
      set((prev) => ({
        isSubmitting: false,
        inbox: prev.inbox.filter((item) => item.proposal.id !== proposalId),
      }));
      return true;
    } catch (err) {
      set({ isSubmitting: false, error: extractErrorKey(err, NEGOTIATION_ERROR_KEYS.REJECT) });
      return false;
    }
  },

  counterBack: async (proposalId, priceCents) => {
    set({ isSubmitting: true, error: null });
    try {
      await counterProposalRequest(proposalId, { proposedPriceCents: priceCents });
      // The prior Cleaner proposal is now COUNTERED; drop it from the inbox
      set((prev) => ({
        isSubmitting: false,
        inbox: prev.inbox.filter((item) => item.proposal.id !== proposalId),
      }));
      return true;
    } catch (err) {
      set({ isSubmitting: false, error: extractErrorKey(err, NEGOTIATION_ERROR_KEYS.COUNTER) });
      return false;
    }
  },

  // ─── Real-time ─────────────────────────────────────────────────────────────

  handleNegotiationEvent: (event) => {
    const { processedEventIds } = get();

    // Dedup by eventId
    if (processedEventIds.has(event.eventId)) {
      return;
    }

    const updatedIds = new Set(processedEventIds);
    updatedIds.add(event.eventId);

    // Version-gate: only apply if this event is newer than the thread we hold
    const existing = get().myThreads.get(event.offerId);
    if (existing && event.version <= existing.version) {
      set({ processedEventIds: updatedIds });
      return;
    }

    set({ processedEventIds: updatedIds });

    // A fresh fetch reconciles state (REST authoritative). Fire-and-forget.
    void get().fetchThread(event.offerId);
  },

  // ─── Derived preview ───────────────────────────────────────────────────────

  computePreviewPayout: (priceCents, hostFeeRateBps, cleanerRateBps, currency) => {
    const hostFee = Math.trunc((priceCents * hostFeeRateBps) / BPS_DIVISOR);
    const cleanerCommission = Math.trunc((priceCents * cleanerRateBps) / BPS_DIVISOR);
    return {
      proposedPriceCents: priceCents,
      cleanerPayoutCents: priceCents - cleanerCommission,
      hostTotalCents: priceCents + hostFee,
      currency,
    };
  },

  isWithinBounds: (basePriceCents, priceCents) =>
    isWithinDeviationBounds(basePriceCents, priceCents),

  clearError: () => set({ error: null }),

  reset: () => set({ ...initialState, myThreads: new Map(), processedEventIds: new Set() }),
}));

/** Convenience hook returning the full negotiation store. */
export function useNegotiation(): NegotiationStore {
  return useNegotiationStore();
}

/** Re-exported preview helpers for components. */
export { getDeviationRange, isWithinDeviationBounds };

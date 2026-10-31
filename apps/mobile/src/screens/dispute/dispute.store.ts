/**
 * dispute.store — Zustand store for dispute-system (one store per domain, Spec 21).
 *
 * Holds the authoritative dispute (from `GET`) + a best-effort connection status. Evidence
 * submissions reconcile via `GET`; state application is idempotent and never regresses a terminal
 * dispute. `GET` reconciliation is authority; realtime is advisory. Never persists a bare object key.
 * There is NO create action — the case is created by service-completion's routing. Errors surface as
 * i18n key strings.
 */

import { create } from 'zustand';

import {
  addStructuredEvidenceRequest,
  finalizeUploadRequest,
  getDisputeRequest,
  requestUploadRequest,
} from './dispute.api';
import { DISPUTE_I18N_KEYS } from './dispute.constants';
import type { ConnectionStatus, Dispute, DisputeEvidenceKind } from './dispute.types';

/** Terminal dispute states never accept a regressing optimistic update. */
const TERMINAL_STATES: readonly Dispute['state'][] = ['RESOLVED', 'EXPIRED'];

export interface DisputeStoreState {
  dispute: Dispute | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
  isSubmitting: boolean;
}

export interface DisputeStoreActions {
  /** Load (or reload) the authoritative dispute via `GET`. */
  loadDispute: (id: string) => Promise<void>;
  /** Request a grant-gated upload target for a photo (returns the target, never persisted as state). */
  requestUpload: (id: string) => Promise<{ objectKey: string; uploadUrl: string } | null>;
  /** Finalize an uploaded photo, then reconcile via `GET`. */
  finalizeUpload: (id: string, objectKey: string) => Promise<void>;
  /** Add a structured note/reason within the window, then reconcile via `GET`. */
  addStructuredEvidence: (id: string, kind: DisputeEvidenceKind, textValue: string) => Promise<void>;
  /** Reconcile the authoritative dispute via `GET` (best-effort; keeps state on failure). */
  reconcile: (id: string) => Promise<void>;
  /** Set the connection status (driven by a realtime hook, best-effort). */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type DisputeStore = DisputeStoreState & DisputeStoreActions;

const initialState: DisputeStoreState = {
  dispute: null,
  connectionStatus: 'disconnected',
  error: null,
  isSubmitting: false,
};

/** Whether the current dispute is terminal (no optimistic regression allowed). */
function isTerminal(dispute: Dispute | null): boolean {
  return dispute !== null && TERMINAL_STATES.includes(dispute.state);
}

export const useDisputeStore = create<DisputeStore>((set, get) => ({
  ...initialState,

  loadDispute: async (id) => {
    set({ error: null });
    try {
      const dispute = await getDisputeRequest(id);
      set({ dispute });
    } catch {
      set({ error: DISPUTE_I18N_KEYS.LOAD_ERROR });
    }
  },

  requestUpload: async (id) => {
    if (isTerminal(get().dispute)) {
      return null;
    }
    set({ error: null, isSubmitting: true });
    try {
      const target = await requestUploadRequest(id);
      // Never persist the object key as durable state — it is used immediately then discarded.
      return { objectKey: target.objectKey, uploadUrl: target.uploadUrl };
    } catch {
      set({ error: DISPUTE_I18N_KEYS.ACTION_ERROR });
      return null;
    } finally {
      set({ isSubmitting: false });
    }
  },

  finalizeUpload: async (id, objectKey) => {
    await runAction(set, () => finalizeUploadRequest(id, objectKey));
    await get().reconcile(id);
  },

  addStructuredEvidence: async (id, kind, textValue) => {
    await runAction(set, () => addStructuredEvidenceRequest(id, kind, textValue));
    await get().reconcile(id);
  },

  reconcile: async (id) => {
    try {
      const dispute = await getDisputeRequest(id);
      set({ dispute });
    } catch {
      // Reconciliation is best-effort; keep existing state (recovered on the next attempt).
    }
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  reset: () => {
    set({ ...initialState });
  },
}));

/** Run a mutating action guarding `isSubmitting` and surfacing an i18n error key on failure. */
async function runAction(
  set: (partial: Partial<DisputeStoreState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  set({ error: null, isSubmitting: true });
  try {
    await action();
  } catch {
    set({ error: DISPUTE_I18N_KEYS.ACTION_ERROR });
  } finally {
    set({ isSubmitting: false });
  }
}

/** Convenience hook returning the full dispute store. */
export function useDispute(): DisputeStore {
  return useDisputeStore();
}

export default useDispute;

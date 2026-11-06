/**
 * voip.store — Zustand store for in-conversation calling (Spec 15).
 *
 * Tracks at most one active call at a time (the domain allows one non-terminal call per
 * conversation) plus a per-conversation call log. The store is the client's local view of the
 * server-authoritative state machine: it applies call-control signals idempotently, NEVER
 * regressing a call's status (a late `call_ringing` after `call_end` is ignored — P15), and always
 * reconciles the truth via a GET on the call. Media reconnect requests a fresh token for the SAME
 * ONGOING room and never creates a second call.
 *
 * Presentation seam: `openIncoming(callId, conversationId)` is the invocable side of
 * `NotificationRouter.openIncomingCall` — push (Spec 16) calls it to surface the incoming-call
 * sheet; it reconciles the call via GET (never trusts the deep-link payload as authority).
 *
 * The store never talks to the network beyond the typed `voip.api` calls and owns no transport /
 * LiveKit logic (signaling lives in `useCallSignaling`, media in `useLiveKitRoom`). Errors surface
 * as i18n key strings. Room names / tokens are held only in memory for the active call.
 */

import { create } from 'zustand';
import * as Crypto from 'expo-crypto';

import {
  answerCallRequest,
  cancelCallRequest,
  declineCallRequest,
  endCallRequest,
  getCallRequest,
  initiateCallRequest,
  listCallsRequest,
  requestMediaTokenRequest,
} from './voip.api';
import { VOIP_I18N_KEYS } from './voip.constants';
import {
  callStatusRank,
  isTerminalCallStatus,
  type ActiveCall,
  type CallSignal,
  type CallStatus,
  type CallUiPhase,
  type CallView,
  type MediaKind,
  type MediaToken,
} from './voip.types';

const CLIENT_CALL_ID_BYTES = 16;

/** Generate a cryptographically random clientCallId (also the Idempotency-Key). */
async function generateClientCallId(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(CLIENT_CALL_ID_BYTES);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Store Interface ─────────────────────────────────────────────────────────

export interface VoipState {
  /** The single active (or just-ended, briefly retained) call, or null when idle. */
  activeCall: ActiveCall | null;
  /** Per-conversation call log, most-recent first. */
  callLogByConversation: Map<string, CallView[]>;
  /** Last error as an i18n key (cleared on the next successful action). */
  error: string | null;
}

export interface VoipActions {
  /** Initiate an outgoing call for a conversation (idempotent by a generated clientCallId). */
  initiate: (conversationId: string, mediaKind: MediaKind) => Promise<void>;
  /** Answer the current incoming call: obtains the callee's media token, moves to `active`. */
  answer: () => Promise<void>;
  /** Decline the current incoming call. */
  decline: () => Promise<void>;
  /** Cancel the current outgoing call before it is answered. */
  cancel: () => Promise<void>;
  /** End the active call (hang up). */
  end: () => Promise<void>;
  /** Request a fresh media token for the active ONGOING call (media reconnect — same room). */
  refreshMediaToken: () => Promise<void>;
  /** Apply a call-control signal received on the conversation channel (idempotent, never regresses). */
  applySignal: (conversationId: string, signal: CallSignal) => void;
  /** Reconcile a call's authoritative state via GET (drops the active call once terminal). */
  reconcile: (conversationId: string, callId: string) => Promise<void>;
  /**
   * Open the incoming-call UI for a pushed/deep-linked call (the invocable side of
   * `NotificationRouter.openIncomingCall`). Reconciles via GET; only presents while still RINGING.
   */
  openIncoming: (callId: string, conversationId: string) => Promise<void>;
  /** Dismiss a terminal active call from the UI (returns to idle). */
  dismissActive: () => void;
  /** Load the call log for a conversation (missed-call UX). */
  loadCallLog: (conversationId: string) => Promise<void>;
  /** Read the call log for a conversation (empty when unknown). */
  getCallLog: (conversationId: string) => CallView[];
  /** Clear the last error. */
  clearError: () => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type VoipStore = VoipState & VoipActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: VoipState = {
  activeCall: null,
  callLogByConversation: new Map(),
  error: null,
};

// ─── Pure Helpers ──────────────────────────────────────────────────────────────

/** Derive the presentation phase from a call status + whether the local user initiated it. */
function derivePhase(status: CallStatus, isInitiator: boolean): CallUiPhase {
  if (status === 'RINGING') {
    return isInitiator ? 'outgoing' : 'incoming';
  }
  if (status === 'ONGOING') {
    return 'active';
  }
  return 'ended';
}

/** Upsert a call into a conversation's log (dedup by id, newest-first by initiatedAt). */
function upsertLog(
  logByConversation: Map<string, CallView[]>,
  conversationId: string,
  call: CallView,
): Map<string, CallView[]> {
  const next = new Map(logByConversation);
  const current = next.get(conversationId) ?? [];
  const byId = new Map<string, CallView>();
  for (const entry of current) {
    byId.set(entry.id, entry);
  }
  byId.set(call.id, call);
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime(),
  );
  next.set(conversationId, merged);
  return next;
}

/**
 * Whether an incoming call VIEW may replace the active call without regressing it. A view is
 * applied only when it belongs to the active call and its status does not move backwards.
 */
function viewSupersedes(active: ActiveCall | null, callId: string, status: CallStatus): boolean {
  if (!active || active.call.id !== callId) {
    return false;
  }
  return callStatusRank(status) >= callStatusRank(active.call.status);
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useVoipStore = create<VoipStore>((set, get) => ({
  ...initialState,

  // ─── Outgoing / answer / terminal transitions ────────────────────────────────

  initiate: async (conversationId, mediaKind) => {
    set({ error: null });
    try {
      const clientCallId = await generateClientCallId();
      const initiated = await initiateCallRequest(conversationId, clientCallId, mediaKind);
      set({
        activeCall: {
          call: initiated.call,
          phase: derivePhase(initiated.call.status, true),
          media: initiated.media,
          roomName: initiated.roomName,
          isInitiator: true,
        },
        callLogByConversation: upsertLog(
          get().callLogByConversation,
          conversationId,
          initiated.call,
        ),
      });
    } catch {
      set({ error: VOIP_I18N_KEYS.BUSY });
    }
  },

  answer: async () => {
    const active = get().activeCall;
    if (!active || active.phase !== 'incoming') {
      return;
    }
    set({ error: null });
    try {
      const media = await answerCallRequest(active.call.conversationId, active.call.id);
      // Reconcile the authoritative state; the answer transitions RINGING → ONGOING.
      const call = await getCallRequest(active.call.conversationId, active.call.id);
      set({
        activeCall: {
          call,
          phase: derivePhase(call.status, active.isInitiator),
          media,
          roomName: active.roomName,
          isInitiator: active.isInitiator,
        },
        callLogByConversation: upsertLog(
          get().callLogByConversation,
          call.conversationId,
          call,
        ),
      });
    } catch {
      set({ error: VOIP_I18N_KEYS.ERROR });
    }
  },

  decline: async () => {
    const active = get().activeCall;
    if (!active) {
      return;
    }
    await runTerminalTransition(set, get, active, () =>
      declineCallRequest(active.call.conversationId, active.call.id),
    );
  },

  cancel: async () => {
    const active = get().activeCall;
    if (!active) {
      return;
    }
    await runTerminalTransition(set, get, active, () =>
      cancelCallRequest(active.call.conversationId, active.call.id),
    );
  },

  end: async () => {
    const active = get().activeCall;
    if (!active) {
      return;
    }
    await runTerminalTransition(set, get, active, () =>
      endCallRequest(active.call.conversationId, active.call.id),
    );
  },

  refreshMediaToken: async () => {
    const active = get().activeCall;
    if (!active || active.call.status !== 'ONGOING') {
      return;
    }
    try {
      const media = await requestMediaTokenRequest(active.call.conversationId, active.call.id);
      // A reconnect rejoins the SAME call/room; never create a second call record.
      const current = get().activeCall;
      if (current && current.call.id === active.call.id) {
        set({ activeCall: { ...current, media } });
      }
    } catch {
      set({ error: VOIP_I18N_KEYS.ERROR });
    }
  },

  // ─── Realtime signal intake ────────────────────────────────────────────────────

  applySignal: (conversationId, signal) => {
    const active = get().activeCall;

    // An invite for a conversation we're not already in an active call for surfaces as incoming.
    if (signal.type === 'call_invite') {
      // Ignore an invite that duplicates the call we already track (idempotent).
      if (active && active.call.id === signal.callId) {
        return;
      }
      // Do not clobber a different in-progress call (busy handled server-side); reconcile the new one.
      if (!active || isTerminalCallStatus(active.call.status)) {
        void get().openIncoming(signal.callId, conversationId);
      }
      return;
    }

    // busy: our outgoing attempt collided with an existing active call — surface + reconcile.
    if (signal.type === 'call_busy') {
      set({ error: VOIP_I18N_KEYS.BUSY });
      return;
    }

    // For all other signals, they only matter for the call we already track.
    if (!active || active.call.id !== signal.callId) {
      return;
    }

    // A terminal signal drives the call terminal, then reconciles the authoritative view.
    if (signal.type === 'call_end' || signal.type === 'call_decline' || signal.type === 'call_cancel') {
      void get().reconcile(conversationId, signal.callId);
      return;
    }

    // call_accept: the callee answered our outgoing call → reconcile to ONGOING.
    if (signal.type === 'call_accept') {
      void get().reconcile(conversationId, signal.callId);
      return;
    }

    // call_ringing: a device ack; never regresses. Only meaningful while still RINGING.
    // No state change needed — the outgoing UI is already ringing.
  },

  reconcile: async (conversationId, callId) => {
    try {
      const call = await getCallRequest(conversationId, callId);
      set({
        callLogByConversation: upsertLog(get().callLogByConversation, conversationId, call),
      });

      const active = get().activeCall;
      if (!active || active.call.id !== callId) {
        return;
      }
      // Never regress the active call's status from a stale read.
      if (!viewSupersedes(active, callId, call.status)) {
        return;
      }
      set({
        activeCall: {
          ...active,
          call,
          phase: derivePhase(call.status, active.isInitiator),
        },
      });
    } catch {
      // Reconciliation is best-effort; keep existing state (recovered on the next attempt).
    }
  },

  openIncoming: async (callId, conversationId) => {
    set({ error: null });
    try {
      const call = await getCallRequest(conversationId, callId);
      // Only present the incoming sheet while the call is still RINGING; otherwise just log it.
      const nextLog = upsertLog(get().callLogByConversation, conversationId, call);
      if (call.status === 'RINGING') {
        set({
          activeCall: {
            call,
            phase: 'incoming',
            media: null,
            roomName: null,
            isInitiator: false,
          },
          callLogByConversation: nextLog,
        });
      } else {
        set({ callLogByConversation: nextLog });
      }
    } catch {
      set({ error: VOIP_I18N_KEYS.ERROR });
    }
  },

  dismissActive: () => {
    const active = get().activeCall;
    if (active && isTerminalCallStatus(active.call.status)) {
      set({ activeCall: null });
    }
  },

  // ─── Call log ─────────────────────────────────────────────────────────────────

  loadCallLog: async (conversationId) => {
    try {
      const calls = await listCallsRequest(conversationId, null);
      let next = get().callLogByConversation;
      for (const call of calls) {
        next = upsertLog(next, conversationId, call);
      }
      set({ callLogByConversation: next });
    } catch {
      // A call-log fetch failure is non-fatal to chat; leave existing state.
    }
  },

  getCallLog: (conversationId) => get().callLogByConversation.get(conversationId) ?? [],

  clearError: () => set({ error: null }),

  reset: () =>
    set({ activeCall: null, callLogByConversation: new Map(), error: null }),
}));

// ─── Internal: shared terminal runner ─────────────────────────────────────────

type SetState = (partial: Partial<VoipStore>) => void;
type GetState = () => VoipStore;

/**
 * A shared runner for decline/cancel/end: run the terminal request, apply the returned terminal
 * view (without regressing), then log it. On error, reconcile so the UI converges on server truth.
 */
async function runTerminalTransition(
  set: SetState,
  get: GetState,
  active: ActiveCall,
  request: () => Promise<CallView>,
): Promise<void> {
  set({ error: null });
  try {
    const call = await request();
    const current = get().activeCall;
    const nextLog = upsertLog(get().callLogByConversation, call.conversationId, call);
    if (current && current.call.id === call.id) {
      set({
        activeCall: {
          ...current,
          call,
          phase: derivePhase(call.status, current.isInitiator),
        },
        callLogByConversation: nextLog,
      });
    } else {
      set({ callLogByConversation: nextLog });
    }
  } catch {
    // Even on error, reconcile so the UI converges on the server truth.
    await get().reconcile(active.call.conversationId, active.call.id);
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/** Convenience hook returning the full voip store. */
export function useVoip(): VoipStore {
  return useVoipStore();
}

/** Build a media-token accessor for a media token that is safe to pass into the LiveKit hook. */
export function selectActiveMedia(store: VoipStore): MediaToken | null {
  return store.activeCall?.media ?? null;
}

export default useVoip;

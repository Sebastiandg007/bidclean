/**
 * voip.types — Mobile domain types for in-conversation calling (Spec 15).
 *
 * Mirrors the backend `voip` contracts (call view, media token, initiate response) plus the
 * call-control signal union carried best-effort over the EXISTING `chat:conversation:{id}`
 * Centrifugo channel. A call is a conversation event: its two participants are the conversation's
 * `hostId`/`cleanerId`, resolved server-side — never from client identity or possession of a room
 * name. The `roomName` and media `token` only ever arrive on the token-bearing responses
 * (initiate/answer/token); call reads and history never carry a media credential.
 */

/** Call lifecycle status (server-authoritative state machine). */
export type CallStatus =
  | 'RINGING'
  | 'ONGOING'
  | 'ENDED'
  | 'MISSED'
  | 'DECLINED'
  | 'CANCELED'
  | 'FAILED';

/** Media kind: audio (default) or video (optional, capability-gated, degrades to audio). */
export type MediaKind = 'AUDIO' | 'VIDEO';

/** Terminal cause paired with a terminal status. */
export type EndReason =
  | 'HANGUP'
  | 'DECLINED'
  | 'CANCELED'
  | 'TIMEOUT_NO_ANSWER'
  | 'TIMEOUT'
  | 'CONVERSATION_CLOSED'
  | 'ERROR';

/** The non-terminal statuses: a call in one of these is still live. */
export const NON_TERMINAL_CALL_STATUSES: readonly CallStatus[] = ['RINGING', 'ONGOING'];

/** Whether a status is non-terminal (RINGING | ONGOING). */
export function isNonTerminalCallStatus(status: CallStatus): boolean {
  return NON_TERMINAL_CALL_STATUSES.includes(status);
}

/** Whether a status is terminal (immutable). */
export function isTerminalCallStatus(status: CallStatus): boolean {
  return !isNonTerminalCallStatus(status);
}

/**
 * Monotonic rank of a call status: a higher rank is "later" in the lifecycle. The client applies a
 * signaling event only when it does not REGRESS the call's status (P15). RINGING(0) → ONGOING(1) →
 * any terminal(2); a terminal status never moves back to a non-terminal one.
 */
export function callStatusRank(status: CallStatus): number {
  if (status === 'RINGING') {
    return 0;
  }
  if (status === 'ONGOING') {
    return 1;
  }
  return 2;
}

/** The client-facing view of a call (no room name — never a stable public identifier). */
export interface CallView {
  readonly id: string;
  readonly conversationId: string;
  readonly initiatorId: string | null;
  readonly calleeId: string | null;
  readonly mediaKind: MediaKind;
  readonly status: CallStatus;
  readonly endReason: EndReason | null;
  readonly initiatedAt: string;
  readonly answeredAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
}

/** A short-lived, room-scoped LiveKit access token plus its media endpoint. */
export interface MediaToken {
  readonly livekitUrl: string;
  readonly token: string;
  readonly expiresAt: string;
}

/** The initiate response: the persisted call, the room, and the initiator's own media token. */
export interface InitiatedCall {
  readonly call: CallView;
  readonly roomName: string;
  readonly media: MediaToken;
}

/** Call-control signal event names (best-effort transport; the DB state machine is authoritative). */
export const CallSignalType = {
  CALL_INVITE: 'call_invite',
  CALL_RINGING: 'call_ringing',
  CALL_ACCEPT: 'call_accept',
  CALL_DECLINE: 'call_decline',
  CALL_CANCEL: 'call_cancel',
  CALL_END: 'call_end',
  CALL_BUSY: 'call_busy',
} as const;
export type CallSignalType = (typeof CallSignalType)[keyof typeof CallSignalType];

/** invite: initiator → callee; carries the minimal fields the callee needs to render the ring. */
export interface CallInviteSignal {
  readonly type: typeof CallSignalType.CALL_INVITE;
  readonly callId: string;
  readonly conversationId: string;
  readonly initiatorId: string | null;
  readonly mediaKind: MediaKind;
}

/** ringing / accept / decline / cancel: minimal, carry only the callId. */
export interface CallStatusSignal {
  readonly type:
    | typeof CallSignalType.CALL_RINGING
    | typeof CallSignalType.CALL_ACCEPT
    | typeof CallSignalType.CALL_DECLINE
    | typeof CallSignalType.CALL_CANCEL;
  readonly callId: string;
}

/** end: either party / server; carries the terminal cause + derived duration. */
export interface CallEndSignal {
  readonly type: typeof CallSignalType.CALL_END;
  readonly callId: string;
  readonly endReason: EndReason;
  readonly durationSeconds: number | null;
}

/** busy: an active call already exists — minimal by design (at most `{ callId }`). */
export interface CallBusySignal {
  readonly type: typeof CallSignalType.CALL_BUSY;
  readonly callId: string;
}

/** The discriminated union of all call-control signals. */
export type CallSignal =
  | CallInviteSignal
  | CallStatusSignal
  | CallEndSignal
  | CallBusySignal;

/**
 * Local-only presentation phase for the active-call UI, derived from the call status + role. This
 * never leaks to the server; it drives which sheet/screen renders.
 */
export type CallUiPhase =
  | 'idle'
  | 'outgoing' // we initiated; RINGING, awaiting answer (cancelable)
  | 'incoming' // an invite arrived for us; RINGING (accept/decline)
  | 'active' // ONGOING; the in-call screen
  | 'ended'; // terminal; a brief summary then dismiss

/** The active call the store tracks, plus its media credential once obtained. */
export interface ActiveCall {
  readonly call: CallView;
  /** The presentation phase derived from status + whether we are the initiator. */
  readonly phase: CallUiPhase;
  /** The media token + room, present once we have joined (initiate/answer/token). */
  readonly media: MediaToken | null;
  readonly roomName: string | null;
  /** Whether the local user initiated this call (drives outgoing vs incoming). */
  readonly isInitiator: boolean;
}

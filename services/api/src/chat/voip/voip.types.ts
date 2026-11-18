/**
 * voip-calls domain types + error strings (Spec 15).
 *
 * Internal contracts for the call state machine, media-token minting, and call-control signaling.
 * Call metadata (participant ids, room name) is sensitive: room names are never exposed as stable
 * public identifiers, and no participant PII (phone/email) is ever placed in a signaling payload,
 * error message, or log line — only structural/authorization/lifecycle facts appear here.
 */

import type { CallStatus, EndReason, MediaKind } from './voip.constants';

export { CallStatus, EndReason, MediaKind } from './voip.constants';
export { isNonTerminalStatus, isTerminalStatus } from './voip.constants';

/**
 * The client-facing view of a call. The `roomName` is included ONLY on the token-bearing responses
 * (initiate/answer/token) where the caller is already authorized to join; call reads/history use
 * {@link CallView} without any media credential.
 */
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

/** A short-lived, room-scoped, identity-scoped LiveKit access token plus its media endpoint. */
export interface MediaToken {
  readonly livekitUrl: string;
  readonly token: string;
  readonly expiresAt: string;
}

/** The initiate response: the persisted call, plus the initiator's own media token + room. */
export interface InitiatedCall {
  readonly call: CallView;
  readonly roomName: string;
  readonly media: MediaToken;
}

/** Parameters for initiating a call (from the controller DTO + resolved caller identity). */
export interface InitiateParams {
  readonly conversationId: string;
  readonly callerId: string;
  readonly clientCallId: string;
  readonly mediaKind: MediaKind;
}

/**
 * Call-control signal event names published over the EXISTING chat conversation channel
 * (`chat:conversation:{id}`). Best-effort transport; the DB state machine is authoritative. Each
 * event is idempotent by `callId` (+ the monotonic call status) — a client ignores an event that
 * regresses the call's status.
 */
export const SignalEventType = {
  CALL_INVITE: 'call_invite',
  CALL_RINGING: 'call_ringing',
  CALL_ACCEPT: 'call_accept',
  CALL_DECLINE: 'call_decline',
  CALL_CANCEL: 'call_cancel',
  CALL_END: 'call_end',
  CALL_BUSY: 'call_busy',
} as const;
export type SignalEventType =
  (typeof SignalEventType)[keyof typeof SignalEventType];

/** invite: initiator -> callee, carries the minimal fields the callee needs to render the ring. */
export interface CallInviteSignal {
  readonly type: typeof SignalEventType.CALL_INVITE;
  readonly callId: string;
  readonly conversationId: string;
  readonly initiatorId: string | null;
  readonly mediaKind: MediaKind;
}

/** ringing / accept / decline / cancel: minimal, carry only the callId. */
export interface CallStatusSignal {
  readonly type:
    | typeof SignalEventType.CALL_RINGING
    | typeof SignalEventType.CALL_ACCEPT
    | typeof SignalEventType.CALL_DECLINE
    | typeof SignalEventType.CALL_CANCEL;
  readonly callId: string;
}

/** end: either party / server, carries the terminal cause + derived duration. */
export interface CallEndSignal {
  readonly type: typeof SignalEventType.CALL_END;
  readonly callId: string;
  readonly endReason: EndReason;
  readonly durationSeconds: number | null;
}

/**
 * busy: an active call already exists — MINIMAL by design (at most `{ callId }`), never revealing
 * the existing call's room_name, token, or any other internal detail (Req 1.6).
 */
export interface CallBusySignal {
  readonly type: typeof SignalEventType.CALL_BUSY;
  readonly callId: string;
}

/** The discriminated union of all call-control signals. */
export type SignalEvent =
  | CallInviteSignal
  | CallStatusSignal
  | CallEndSignal
  | CallBusySignal;

/**
 * voip-calls error messages.
 *
 * Non-sensitive, structural/authorization/lifecycle strings only. Never embed a room name,
 * participant PII, or any media detail — so no sensitive content leaks into logs or responses.
 */
export const VOIP_ERROR_MESSAGES = {
  /** The conversation for the call does not exist (or the caller may not learn it does). */
  CONVERSATION_NOT_FOUND: 'Conversation not found',
  /** The caller is not a participant of the call's conversation. */
  NOT_A_PARTICIPANT: 'Not a participant of this conversation',
  /** A call cannot start (or continue to be initiated) on a CLOSED conversation. */
  CONVERSATION_CLOSED: 'This conversation is closed',
  /** A non-terminal call already exists for the conversation (busy). */
  CALL_BUSY: 'A call is already active for this conversation',
  /** Same clientCallId reused with a different active call payload. */
  CLIENT_CALL_ID_CONFLICT: 'clientCallId was already used for a different call',
  /** The referenced call does not exist (or the caller may not learn it does). */
  CALL_NOT_FOUND: 'Call not found',
  /** The requested lifecycle transition is not permitted from the call's current status. */
  ILLEGAL_TRANSITION: 'This call transition is not allowed',
  /** The caller is not the participant permitted to perform this action (e.g. answer as callee). */
  WRONG_ROLE: 'Not permitted to perform this call action',
  /** No media token may be issued for the call's current status/role (status+role gate). */
  TOKEN_NOT_ALLOWED: 'A media token cannot be issued for this call',
  /** The authenticated Keycloak subject does not resolve to a BidClean user. */
  USER_NOT_FOUND: 'User not found',
} as const;

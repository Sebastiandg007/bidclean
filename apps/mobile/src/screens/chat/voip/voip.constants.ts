/**
 * voip.constants — Mobile config, endpoints, and i18n keys for in-conversation calling (Spec 15).
 *
 * Call endpoints extend the backend chat controller surface (`/chat/conversations/:id/calls`).
 * Signaling reuses the EXISTING chat conversation channel (`chat:conversation:{id}`) — voip
 * introduces no new channel or token surface. The LiveKit media URL is read from
 * `EXPO_PUBLIC_LIVEKIT_URL` as a fallback, but the authoritative URL always arrives inside the
 * server-minted token payload (`media.livekitUrl`); no LiveKit credential is ever embedded here.
 * All tunables come from `EXPO_PUBLIC_*` with sensible fallbacks — no magic numbers in logic.
 */

/** Backend REST endpoints for calls (extend the chat conversation surface). */
export const VOIP_ENDPOINTS = {
  calls: (conversationId: string): string => `/chat/conversations/${conversationId}/calls`,
  call: (conversationId: string, callId: string): string =>
    `/chat/conversations/${conversationId}/calls/${callId}`,
  answer: (conversationId: string, callId: string): string =>
    `/chat/conversations/${conversationId}/calls/${callId}/answer`,
  decline: (conversationId: string, callId: string): string =>
    `/chat/conversations/${conversationId}/calls/${callId}/decline`,
  cancel: (conversationId: string, callId: string): string =>
    `/chat/conversations/${conversationId}/calls/${callId}/cancel`,
  end: (conversationId: string, callId: string): string =>
    `/chat/conversations/${conversationId}/calls/${callId}/end`,
  token: (conversationId: string, callId: string): string =>
    `/chat/conversations/${conversationId}/calls/${callId}/token`,
} as const;

/**
 * LiveKit media URL fallback. The authoritative URL is the `livekitUrl` inside the minted token
 * payload returned by the server; this fallback exists only for early UI wiring and is never a
 * credential.
 */
export const LIVEKIT_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? '';

/** Whether the video-call affordance is offered on the client (server remains authoritative). */
export const VOIP_VIDEO_ENABLED =
  (process.env.EXPO_PUBLIC_VOIP_VIDEO_ENABLED ?? 'true').toLowerCase() === 'true';

/** History page size for the call log (mirrors the backend default). */
export const VOIP_CALL_HISTORY_PAGE_SIZE = parseInt(
  process.env.EXPO_PUBLIC_VOIP_CALL_HISTORY_PAGE_SIZE ?? '50',
  10,
);

/**
 * How long (ms) the outgoing "ringing" UI waits before treating an unanswered call as timed out
 * locally and reconciling via GET. The SERVER is authoritative (the ring-timeout sweep force-ends
 * it to MISSED); this is only a client-side reconcile nudge so the UI never hangs on a lost signal.
 */
export const VOIP_OUTGOING_RECONCILE_MS = parseInt(
  process.env.EXPO_PUBLIC_VOIP_OUTGOING_RECONCILE_MS ?? '50000',
  10,
);

/** In-call duration tick interval (ms) for the elapsed-time display. */
export const VOIP_DURATION_TICK_MS = 1000;

/** i18n keys for the call UI (en/es in parity, under the shared `chat` namespace). */
export const VOIP_I18N_KEYS = {
  CALL_VOICE: 'chat.call.voice',
  CALL_VIDEO: 'chat.call.video',
  RINGING_OUTGOING: 'chat.call.ringingOutgoing',
  RINGING_INCOMING: 'chat.call.ringingIncoming',
  INCOMING_TITLE: 'chat.call.incomingTitle',
  ACCEPT: 'chat.call.accept',
  DECLINE: 'chat.call.decline',
  CANCEL: 'chat.call.cancel',
  END: 'chat.call.end',
  MUTE: 'chat.call.mute',
  UNMUTE: 'chat.call.unmute',
  SPEAKER: 'chat.call.speaker',
  CAMERA_ON: 'chat.call.cameraOn',
  CAMERA_OFF: 'chat.call.cameraOff',
  CONNECTING: 'chat.call.connecting',
  IN_CALL: 'chat.call.inCall',
  AUDIO_ONLY: 'chat.call.audioOnly',
  MIC_DENIED: 'chat.call.micDenied',
  CAMERA_DENIED: 'chat.call.cameraDenied',
  BUSY: 'chat.call.busy',
  ERROR: 'chat.call.error',
  // Call-log entries (history / missed-call UX)
  LOG_OUTGOING: 'chat.call.log.outgoing',
  LOG_INCOMING: 'chat.call.log.incoming',
  LOG_MISSED: 'chat.call.log.missed',
  LOG_DECLINED: 'chat.call.log.declined',
  LOG_CANCELED: 'chat.call.log.canceled',
  LOG_ENDED: 'chat.call.log.ended',
  LOG_FAILED: 'chat.call.log.failed',
  LOG_DURATION: 'chat.call.log.duration',
} as const;

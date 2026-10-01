/**
 * voip.router — the invocable side of the incoming-call seam (Spec 15).
 *
 * `push-notifications` (Spec 16) declares `NotificationRouter.openIncomingCall(callId,
 * conversationId)` and calls it when an `incoming_call` deep-link arrives. This module implements
 * that call target WITHOUT wiring push transport (push owns delivery): it drives the voip store's
 * `openIncoming`, which reconciles the call via GET and — only while the call is still RINGING —
 * surfaces the `IncomingCallSheet`. Push simply invokes `openIncomingCall`; it never learns call
 * business rules, and voip never imports push.
 *
 * Because the store is a module singleton, this works from any context (a foreground push handler,
 * a deep-link, or a test) without a React tree.
 */

import { useVoipStore } from './voip.store';

/**
 * Open the incoming-call UI for a call (the concrete `NotificationRouter.openIncomingCall`).
 * Reconciles authoritative state via GET; never trusts the deep-link payload as authority.
 */
export function openIncomingCall(callId: string, conversationId: string): void {
  void useVoipStore.getState().openIncoming(callId, conversationId);
}

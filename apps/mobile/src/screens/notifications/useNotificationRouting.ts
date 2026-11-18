/**
 * useNotificationRouting — parse a push deep-link and route to the correct screen.
 *
 * The push `data` deep-link is `{ type, ...ids }`. This hook maps `type` to an in-app route via
 * `DEEP_LINK_ROUTES`, passes the ids as params, and lets the target screen reconcile authoritative
 * state via the owning module's GET. An `incoming_call` deep-link opens the Spec 15 incoming-call
 * sheet (accept/decline) rather than a plain navigation. Foreground de-dup is applied fail-open.
 *
 * `navigate` and `openIncomingCall` are injected so the hook is portable across the navigation
 * stack and unit-testable without a navigator.
 */

import { useCallback } from 'react';

import { DEEP_LINK_ROUTES } from './notifications.constants';
import { useNotificationsStore } from './notifications.store';
import type { NotificationDeepLink, ReceivedPush } from './notifications.types';

/** Navigation surface the routing hook needs. */
export interface NotificationRouter {
  /** Navigate to a route with id params (the screen GET-reconciles). */
  navigate(route: string, params: Record<string, string>): void;
  /** Open the Spec 15 incoming-call sheet for a call deep-link. */
  openIncomingCall(callId: string, conversationId: string): void;
}

/** Extract the id params (everything except `type`) from a deep-link. */
export function deepLinkParams(deepLink: NotificationDeepLink): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(deepLink)) {
    if (key !== 'type') {
      params[key] = value;
    }
  }
  return params;
}

export function useNotificationRouting(router: NotificationRouter): {
  routeFromPush: (push: ReceivedPush) => void;
} {
  const shouldSuppressPush = useNotificationsStore((state) => state.shouldSuppressPush);

  const routeFromPush = useCallback(
    (push: ReceivedPush) => {
      const { deepLink, eventKey } = push;
      const type = deepLink.type;

      // Incoming calls: open the incoming-call UI (accept/decline) and GET-reconcile (Spec 15).
      if (type === 'incoming_call') {
        const callId = deepLink.callId;
        const conversationId = deepLink.conversationId;
        if (callId && conversationId) {
          router.openIncomingCall(callId, conversationId);
        }
        return;
      }

      // Fail-open foreground de-dup for non-call/message types already shown in-foreground.
      if (shouldSuppressPush(eventKey, type)) {
        return;
      }

      const route = DEEP_LINK_ROUTES[type];
      if (route) {
        router.navigate(route, deepLinkParams(deepLink));
      }
    },
    [router, shouldSuppressPush],
  );

  return { routeFromPush };
}

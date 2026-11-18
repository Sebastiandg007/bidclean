/**
 * Unit tests for useNotificationRouting (Task 15.4).
 * Feature: push-notifications, Property 14 (deep-link routing) + Spec 15 incoming-call handoff.
 *
 * The hook logic is exercised directly via its returned `routeFromPush`; navigation + the
 * incoming-call opener are injected fakes. The store is reset per test for foreground de-dup.
 */

import { renderHook } from '@testing-library/react-native';
import { useNotificationRouting, deepLinkParams, NotificationRouter } from '../useNotificationRouting';
import { useNotificationsStore } from '../notifications.store';
import type { ReceivedPush } from '../notifications.types';

function makeRouter(): jest.Mocked<NotificationRouter> {
  return {
    navigate: jest.fn(),
    openIncomingCall: jest.fn(),
  };
}

function push(type: string, ids: Record<string, string>): ReceivedPush {
  const deepLink = { type, ...ids };
  const eventKey = `${type}:${Object.values(ids).join(':')}`;
  return { eventKey, deepLink };
}

describe('useNotificationRouting', () => {
  beforeEach(() => {
    useNotificationsStore.getState().reset();
  });

  it('deepLinkParams extracts ids only (never type)', () => {
    expect(deepLinkParams({ type: 'offer_matched', offerId: 'o1' })).toEqual({ offerId: 'o1' });
  });

  it('routes an offer_matched push to Radar with the offer id', () => {
    const router = makeRouter();
    const { result } = renderHook(() => useNotificationRouting(router));
    result.current.routeFromPush(push('offer_matched', { offerId: 'o1' }));
    expect(router.navigate).toHaveBeenCalledWith('Radar', { offerId: 'o1' });
  });

  it('routes a new_message push to Chat with the conversation id', () => {
    const router = makeRouter();
    const { result } = renderHook(() => useNotificationRouting(router));
    result.current.routeFromPush(push('new_message', { conversationId: 'c1' }));
    expect(router.navigate).toHaveBeenCalledWith('Chat', { conversationId: 'c1' });
  });

  it('opens the incoming-call sheet for an incoming_call push (Spec 15)', () => {
    const router = makeRouter();
    const { result } = renderHook(() => useNotificationRouting(router));
    result.current.routeFromPush(push('incoming_call', { callId: 'call1', conversationId: 'c1' }));
    expect(router.openIncomingCall).toHaveBeenCalledWith('call1', 'c1');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('suppresses a redundant non-call push already seen in-foreground (fail-open de-dup)', () => {
    useNotificationsStore.getState().recordForegroundEvent('offer_matched:o1');
    const router = makeRouter();
    const { result } = renderHook(() => useNotificationRouting(router));
    result.current.routeFromPush(push('offer_matched', { offerId: 'o1' }));
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('still routes a message push even if its event was seen in-foreground (always fail open)', () => {
    useNotificationsStore.getState().recordForegroundEvent('new_message:c1');
    const router = makeRouter();
    const { result } = renderHook(() => useNotificationRouting(router));
    result.current.routeFromPush(push('new_message', { conversationId: 'c1' }));
    expect(router.navigate).toHaveBeenCalledWith('Chat', { conversationId: 'c1' });
  });
});

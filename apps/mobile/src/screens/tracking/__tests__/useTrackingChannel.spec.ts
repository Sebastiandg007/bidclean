/**
 * Unit tests for useTrackingChannel (Host, Spec 17).
 *
 * A fake WebSocket + mocked token api. Verifies: token fetch on connect, reconcile on open,
 * parsing of position + state signals, read-only (no send/publish path), and teardown on unmount.
 */

const mockFetchConnectionToken = jest.fn();
const mockFetchSessionChannelToken = jest.fn();

jest.mock('../tracking.api', () => ({
  fetchConnectionTokenRequest: (...args: unknown[]) => mockFetchConnectionToken(...args),
  fetchSessionChannelTokenRequest: (...args: unknown[]) => mockFetchSessionChannelToken(...args),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useTrackingChannel } from '../useTrackingChannel';

/** A minimal fake WebSocket capturing handlers + exposing send (to assert it's never called). */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly send = jest.fn();
  readonly close = jest.fn();
  constructor(public readonly url: string) {
    FakeWebSocket.last = this;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  FakeWebSocket.last = null;
  mockFetchConnectionToken.mockResolvedValue('conn-token');
  mockFetchSessionChannelToken.mockResolvedValue('sub-token');
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

function buildHandlers() {
  return {
    onLivePosition: jest.fn(),
    onStateSignal: jest.fn(),
    onConnectionChange: jest.fn(),
    onReconcile: jest.fn(),
  };
}

describe('useTrackingChannel', () => {
  it('fetches both tokens, connects, and reconciles on open (read-only, never sends)', async () => {
    const handlers = buildHandlers();
    renderHook(() => useTrackingChannel({ sessionId: 'sess-1', ...handlers }));

    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());
    expect(mockFetchConnectionToken).toHaveBeenCalled();
    expect(mockFetchSessionChannelToken).toHaveBeenCalledWith('service:session:sess-1');

    act(() => {
      FakeWebSocket.last?.onopen?.();
    });
    expect(handlers.onConnectionChange).toHaveBeenCalledWith('connected');
    expect(handlers.onReconcile).toHaveBeenCalledWith('sess-1');
    // Read-only subscriber: the hook never sends/publishes on the socket.
    expect(FakeWebSocket.last?.send).not.toHaveBeenCalled();
  });

  it('parses a position signal from the Centrifugo envelope', async () => {
    const handlers = buildHandlers();
    renderHook(() => useTrackingChannel({ sessionId: 'sess-1', ...handlers }));
    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());

    act(() => {
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({
          push: { pub: { data: { type: 'position', lat: 4.6, lng: -74.08, accuracy: 8, at: 1 } } },
        }),
      });
    });
    expect(handlers.onLivePosition).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'position', lat: 4.6, lng: -74.08 }),
    );
  });

  it('parses a state signal and ignores malformed frames', async () => {
    const handlers = buildHandlers();
    renderHook(() => useTrackingChannel({ sessionId: 'sess-1', ...handlers }));
    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());

    act(() => {
      FakeWebSocket.last?.onmessage?.({
        data: JSON.stringify({ result: { channel: 'service:session:sess-1', data: { type: 'state', state: 'ARRIVED' } } }),
      });
      FakeWebSocket.last?.onmessage?.({ data: 'not-json{' });
      FakeWebSocket.last?.onmessage?.({ data: JSON.stringify({ type: 'state', state: 'BOGUS' }) });
    });
    expect(handlers.onStateSignal).toHaveBeenCalledTimes(1);
    expect(handlers.onStateSignal).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state', state: 'ARRIVED' }),
    );
  });

  it('tears down the socket on unmount', async () => {
    const handlers = buildHandlers();
    const { unmount } = renderHook(() => useTrackingChannel({ sessionId: 'sess-1', ...handlers }));
    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());
    const ws = FakeWebSocket.last;
    unmount();
    expect(ws?.close).toHaveBeenCalled();
  });
});

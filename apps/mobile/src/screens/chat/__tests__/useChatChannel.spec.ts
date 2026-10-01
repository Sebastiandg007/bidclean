/**
 * Unit tests for useChatChannel (P14).
 *
 * Covers: connection + subscription token fetch on mount, reconcile on (re)connect via the `after`
 * cursor, message parse + dispatch (with Centrifugo envelope unwrapping), teardown on unmount, and
 * no duplicate subscription for a stable conversation id. WebSocket + chat.api are mocked; no real
 * network and no native crypto.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useChatChannel } from '../useChatChannel';
import type { ChatMessage, ConnectionStatus } from '../chat.types';

jest.mock('../chat.api', () => ({
  fetchConnectionTokenRequest: jest.fn().mockResolvedValue('conn-token'),
  fetchSubscriptionTokenRequest: jest.fn().mockResolvedValue('sub-token'),
}));

import {
  fetchConnectionTokenRequest,
  fetchSubscriptionTokenRequest,
} from '../chat.api';

const mockedConnToken = fetchConnectionTokenRequest as jest.MockedFunction<
  typeof fetchConnectionTokenRequest
>;
const mockedSubToken = fetchSubscriptionTokenRequest as jest.MockedFunction<
  typeof fetchSubscriptionTokenRequest
>;

// ─── Controllable WebSocket mock ─────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.onopen?.();
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerClose(): void {
    this.onclose?.();
  }

  close(): void {
    this.closed = true;
  }
}

const CONVERSATION_ID = 'conv-42';

function serverMessage(seq: number): ChatMessage {
  return {
    id: `srv-${seq}`,
    conversationId: CONVERSATION_ID,
    senderId: 'user-1',
    type: 'TEXT',
    body: `message ${seq}`,
    sequenceNumber: seq,
    clientMessageId: `cmid-${seq}`,
    createdAt: new Date(seq * 1000).toISOString(),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  jest.clearAllMocks();
  MockWebSocket.instances = [];
  originalWebSocket = global.WebSocket;
  (global as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
});

afterEach(() => {
  (global as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
});

function lastSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (socket === undefined) {
    throw new Error('expected a WebSocket instance');
  }
  return socket;
}

describe('useChatChannel', () => {
  it('fetches connection + subscription tokens on mount', async () => {
    renderHook(() =>
      useChatChannel({
        conversationId: CONVERSATION_ID,
        onMessage: jest.fn(),
        onConnectionChange: jest.fn(),
        onReconcile: jest.fn(),
      }),
    );
    await flush();

    expect(mockedConnToken).toHaveBeenCalledTimes(1);
    expect(mockedSubToken).toHaveBeenCalledWith(`chat:conversation:${CONVERSATION_ID}`);
  });

  it('reconciles via the after cursor on connect', async () => {
    const onReconcile = jest.fn();
    renderHook(() =>
      useChatChannel({
        conversationId: CONVERSATION_ID,
        onMessage: jest.fn(),
        onConnectionChange: jest.fn(),
        onReconcile,
      }),
    );
    await flush();

    act(() => {
      lastSocket().open();
    });

    expect(onReconcile).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it('reports status transitions connecting → connected', async () => {
    const statuses: ConnectionStatus[] = [];
    renderHook(() =>
      useChatChannel({
        conversationId: CONVERSATION_ID,
        onMessage: jest.fn(),
        onConnectionChange: (status) => statuses.push(status),
        onReconcile: jest.fn(),
      }),
    );
    await flush();
    act(() => {
      lastSocket().open();
    });

    expect(statuses[0]).toBe('connecting');
    expect(statuses).toContain('connected');
  });

  it('parses a Centrifugo push envelope and dispatches the message', async () => {
    const onMessage = jest.fn();
    renderHook(() =>
      useChatChannel({
        conversationId: CONVERSATION_ID,
        onMessage,
        onConnectionChange: jest.fn(),
        onReconcile: jest.fn(),
      }),
    );
    await flush();
    act(() => {
      lastSocket().open();
    });

    const message = serverMessage(3);
    act(() => {
      lastSocket().emit({ push: { pub: { data: { type: 'chat_message', message } } } });
    });

    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it('ignores malformed frames without throwing', async () => {
    const onMessage = jest.fn();
    renderHook(() =>
      useChatChannel({
        conversationId: CONVERSATION_ID,
        onMessage,
        onConnectionChange: jest.fn(),
        onReconcile: jest.fn(),
      }),
    );
    await flush();
    act(() => {
      lastSocket().open();
    });

    act(() => {
      lastSocket().emit({ push: { pub: { data: { not: 'a message' } } } });
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('tears down the socket on unmount', async () => {
    const { unmount } = renderHook(() =>
      useChatChannel({
        conversationId: CONVERSATION_ID,
        onMessage: jest.fn(),
        onConnectionChange: jest.fn(),
        onReconcile: jest.fn(),
      }),
    );
    await flush();
    const socket = lastSocket();

    unmount();

    expect(socket.closed).toBe(true);
  });

  it('does not open a duplicate subscription for a stable conversation id', async () => {
    const { rerender } = renderHook(
      (props: { conversationId: string }) =>
        useChatChannel({
          conversationId: props.conversationId,
          onMessage: jest.fn(),
          onConnectionChange: jest.fn(),
          onReconcile: jest.fn(),
        }),
      { initialProps: { conversationId: CONVERSATION_ID } },
    );
    await flush();
    act(() => {
      lastSocket().open();
    });

    rerender({ conversationId: CONVERSATION_ID });
    await flush();

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

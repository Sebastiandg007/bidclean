/**
 * Unit + property-based tests for the chat Zustand store (P13).
 *
 * Covers:
 * - optimistic send → server confirmation reconciles the placeholder (one entry, no `sendState`)
 * - optimistic send → timeout flips the placeholder to `failed`
 * - a late server confirmation after a timeout still overwrites the failed placeholder
 * - incoming dedup by `id` and by `clientMessageId`
 * - messages held in `sequenceNumber` order regardless of arrival order
 * - `loadOlder` (before) + `reconcileNewer` (after) paging merge without gaps/overlaps
 * - `reset` returns the store to its initial state
 *
 * Property P13: arbitrary interleavings of live + fetched + optimistic messages render each once,
 * in `sequenceNumber` order. `chat.api` and `expo-crypto` are mocked; no network, no native crypto.
 */

import * as fc from 'fast-check';

import { useChatStore } from '../chat.store';
import { CHAT_SEND_TIMEOUT_MS } from '../chat.constants';
import type { ChatMessage, ChatMessagePage, ChatSendResult } from '../chat.types';

jest.mock('../chat.api', () => ({
  openConversationRequest: jest.fn(),
  listConversationsRequest: jest.fn(),
  getMessagesBeforeRequest: jest.fn(),
  getMessagesAfterRequest: jest.fn(),
  sendMessageRequest: jest.fn(),
  fetchConnectionTokenRequest: jest.fn(),
  fetchSubscriptionTokenRequest: jest.fn(),
}));

// Unique client message ids per call (the global setup mock returns fixed bytes, which would
// collapse every optimistic send onto one clientMessageId).
let mockCryptoCounter = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async () => {
    mockCryptoCounter += 1;
    const bytes = new Uint8Array(16);
    bytes[0] = mockCryptoCounter & 0xff;
    bytes[1] = (mockCryptoCounter >> 8) & 0xff;
    return bytes;
  }),
}));

import {
  getMessagesAfterRequest,
  getMessagesBeforeRequest,
  sendMessageRequest,
} from '../chat.api';

const mockedSend = sendMessageRequest as jest.MockedFunction<typeof sendMessageRequest>;
const mockedBefore = getMessagesBeforeRequest as jest.MockedFunction<
  typeof getMessagesBeforeRequest
>;
const mockedAfter = getMessagesAfterRequest as jest.MockedFunction<typeof getMessagesAfterRequest>;

const CONVERSATION_ID = 'conv-1';

function serverMessage(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `srv-${seq}`,
    conversationId: CONVERSATION_ID,
    senderId: 'user-1',
    type: 'TEXT',
    body: `message ${seq}`,
    sequenceNumber: seq,
    clientMessageId: `cmid-${seq}`,
    createdAt: new Date(seq * 1000).toISOString(),
    ...overrides,
  };
}

function page(messages: ChatMessage[], hasMore = false): ChatMessagePage {
  return { messages, hasMore };
}

function sendResult(message: ChatMessage): ChatSendResult {
  return { message, deduplicated: false };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockCryptoCounter = 0;
  useChatStore.getState().reset();
});

describe('chat.store — optimistic send', () => {
  it('reconciles the optimistic placeholder to the confirmed server message', async () => {
    const confirmed = serverMessage(5, { clientMessageId: 'will-be-overwritten' });
    mockedSend.mockImplementation(async (_conv, clientMessageId) =>
      sendResult({ ...confirmed, clientMessageId }),
    );

    await useChatStore.getState().sendMessage(CONVERSATION_ID, 'hello');

    const messages = useChatStore.getState().getMessages(CONVERSATION_ID);
    expect(messages).toHaveLength(1);
    expect(messages[0].sendState).toBeUndefined();
    expect(messages[0].sequenceNumber).toBe(5);
    expect(messages[0].id).toBe('srv-5');
  });

  it('flips the placeholder to failed after the send timeout', async () => {
    jest.useFakeTimers();
    // Never resolves within the timeout window.
    mockedSend.mockImplementation(() => new Promise<ChatSendResult>(() => undefined));

    const promise = useChatStore.getState().sendMessage(CONVERSATION_ID, 'hello');
    // Let the optimistic insert (after the awaited crypto id) settle.
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(CHAT_SEND_TIMEOUT_MS);

    const messages = useChatStore.getState().getMessages(CONVERSATION_ID);
    expect(messages).toHaveLength(1);
    expect(messages[0].sendState).toBe('failed');

    jest.useRealTimers();
    void promise;
  });

  it('a late server confirmation after timeout still replaces the failed placeholder', async () => {
    let resolveSend: (value: ChatSendResult) => void = () => undefined;
    mockedSend.mockImplementation(
      (_conv, clientMessageId) =>
        new Promise<ChatSendResult>((resolve) => {
          resolveSend = (value) => resolve({ ...value, message: { ...value.message, clientMessageId } });
        }),
    );

    jest.useFakeTimers();
    const promise = useChatStore.getState().sendMessage(CONVERSATION_ID, 'hello');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(CHAT_SEND_TIMEOUT_MS);
    expect(useChatStore.getState().getMessages(CONVERSATION_ID)[0].sendState).toBe('failed');

    jest.useRealTimers();
    resolveSend(sendResult(serverMessage(9)));
    await promise;

    const messages = useChatStore.getState().getMessages(CONVERSATION_ID);
    expect(messages).toHaveLength(1);
    expect(messages[0].sendState).toBeUndefined();
    expect(messages[0].sequenceNumber).toBe(9);
  });
});

describe('chat.store — incoming dedup & ordering', () => {
  it('dedups by server id (same message delivered twice = one entry)', () => {
    const message = serverMessage(3);
    useChatStore.getState().onIncomingMessage(message);
    useChatStore.getState().onIncomingMessage(message);

    expect(useChatStore.getState().getMessages(CONVERSATION_ID)).toHaveLength(1);
  });

  it('dedups an optimistic echo by clientMessageId', async () => {
    mockedSend.mockImplementation(async (_conv, clientMessageId) =>
      sendResult(serverMessage(7, { id: 'srv-7', clientMessageId })),
    );
    await useChatStore.getState().sendMessage(CONVERSATION_ID, 'hi');

    // Realtime channel echoes the same message (same clientMessageId) — must not duplicate.
    const echoed = useChatStore.getState().getMessages(CONVERSATION_ID)[0];
    useChatStore.getState().onIncomingMessage(echoed);

    expect(useChatStore.getState().getMessages(CONVERSATION_ID)).toHaveLength(1);
  });

  it('keeps messages sorted by sequenceNumber regardless of arrival order', () => {
    useChatStore.getState().onIncomingMessage(serverMessage(3));
    useChatStore.getState().onIncomingMessage(serverMessage(1));
    useChatStore.getState().onIncomingMessage(serverMessage(2));

    const seqs = useChatStore.getState().getMessages(CONVERSATION_ID).map((m) => m.sequenceNumber);
    expect(seqs).toEqual([1, 2, 3]);
  });
});

describe('chat.store — history paging', () => {
  it('loadOlder merges a before-page ahead of held messages without duplicates', async () => {
    useChatStore.getState().onIncomingMessage(serverMessage(4));
    useChatStore.getState().onIncomingMessage(serverMessage(5));
    mockedBefore.mockResolvedValue(page([serverMessage(2), serverMessage(3)], true));

    await useChatStore.getState().loadOlder(CONVERSATION_ID);

    const seqs = useChatStore.getState().getMessages(CONVERSATION_ID).map((m) => m.sequenceNumber);
    expect(seqs).toEqual([2, 3, 4, 5]);
    expect(mockedBefore).toHaveBeenCalledWith(CONVERSATION_ID, 4);
  });

  it('reconcileNewer merges an after-page from the latest held sequence', async () => {
    useChatStore.getState().onIncomingMessage(serverMessage(1));
    useChatStore.getState().onIncomingMessage(serverMessage(2));
    mockedAfter.mockResolvedValue(page([serverMessage(3), serverMessage(4)]));

    await useChatStore.getState().reconcileNewer(CONVERSATION_ID);

    const seqs = useChatStore.getState().getMessages(CONVERSATION_ID).map((m) => m.sequenceNumber);
    expect(seqs).toEqual([1, 2, 3, 4]);
    expect(mockedAfter).toHaveBeenCalledWith(CONVERSATION_ID, 2);
  });
});

describe('chat.store — reset', () => {
  it('returns the store to its initial state', () => {
    useChatStore.getState().onIncomingMessage(serverMessage(1));
    useChatStore.getState().setConnectionStatus('connected');

    useChatStore.getState().reset();

    const state = useChatStore.getState();
    expect(state.getMessages(CONVERSATION_ID)).toHaveLength(0);
    expect(state.conversations.size).toBe(0);
    expect(state.connectionStatus).toBe('disconnected');
  });
});

describe('chat.store — property P13: dedup & order under arbitrary interleavings', () => {
  it('renders each message once, in sequenceNumber order', () => {
    const messageArb = fc.integer({ min: 1, max: 40 }).map((seq) => serverMessage(seq));

    fc.assert(
      fc.property(fc.array(messageArb, { minLength: 1, maxLength: 60 }), (messages) => {
        useChatStore.getState().reset();
        for (const message of messages) {
          useChatStore.getState().onIncomingMessage(message);
        }

        const held = useChatStore.getState().getMessages(CONVERSATION_ID);
        const seqs = held.map((m) => m.sequenceNumber);

        // Sorted ascending.
        const sorted = [...seqs].sort((a, b) => a - b);
        expect(seqs).toEqual(sorted);

        // Each server id present exactly once.
        const uniqueIds = new Set(held.map((m) => m.id));
        expect(uniqueIds.size).toBe(held.length);

        // Every distinct input sequence is represented exactly once.
        const distinctInputSeqs = new Set(messages.map((m) => m.sequenceNumber));
        expect(held.length).toBe(distinctInputSeqs.size);
      }),
      { numRuns: 100 },
    );
  });
});

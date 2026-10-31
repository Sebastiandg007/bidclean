/**
 * Unit tests for ChatScreen.
 *
 * Covers: renders own vs counterparty messages (alignment via `isOwn`), surfaces send-state
 * affordance for own optimistic messages, shows the closed notice (composer hidden) when the
 * conversation is CLOSED, and renders the empty state. i18n returns keys/defaults; the realtime
 * hook and chat.api are mocked so no WebSocket/network runs.
 */

import { act, render, screen } from '@testing-library/react-native';

const stableT = (key: string, opts?: { defaultValue?: string }): string =>
  opts?.defaultValue ?? key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

// The realtime hook is exercised in its own spec; here it must not open a socket.
jest.mock('../useChatChannel', () => ({
  useChatChannel: () => ({ isConnected: true, disconnect: jest.fn() }),
}));

jest.mock('../chat.api', () => ({
  getMessagesBeforeRequest: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
  getMessagesAfterRequest: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
}));

import { ChatScreen } from '../ChatScreen';
import { useChatStore } from '../chat.store';
import { useAuthStore } from '../../../stores/auth.store';
import type { ChatConversationSummary, ChatMessage } from '../chat.types';

const CONVERSATION_ID = 'conv-1';
const CURRENT_USER_ID = 'user-me';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'srv-1',
    conversationId: CONVERSATION_ID,
    senderId: 'user-other',
    type: 'TEXT',
    body: 'hello',
    sequenceNumber: 1,
    clientMessageId: 'cmid-1',
    createdAt: new Date(1000).toISOString(),
    ...overrides,
  };
}

function conversation(overrides: Partial<ChatConversationSummary> = {}): ChatConversationSummary {
  return {
    id: CONVERSATION_ID,
    threadId: 'thread-1',
    offerId: 'offer-1',
    hostId: 'user-me',
    cleanerId: 'user-other',
    status: 'OPEN',
    lastMessageAt: null,
    createdAt: new Date(0).toISOString(),
    lastMessagePreview: null,
    ...overrides,
  };
}

function seedStore(messages: ChatMessage[], conv: ChatConversationSummary): void {
  useChatStore.setState({
    messagesByConversation: new Map([[CONVERSATION_ID, messages]]),
    conversations: new Map([[CONVERSATION_ID, conv]]),
    connectionStatus: 'connected',
    error: null,
  });
}

const route = { params: { conversationId: CONVERSATION_ID } };
const navigation = { goBack: jest.fn() };

/** Render and flush the async mount effect (loadConversationMessages) inside act. */
async function renderScreen(): Promise<void> {
  render(<ChatScreen route={route} navigation={navigation} />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.getState().reset();
  useAuthStore.setState({
    user: {
      id: CURRENT_USER_ID,
      keycloakId: 'kc',
      email: 'me@example.com',
      fullName: 'Me',
      country: 'US',
      language: 'en',
      isEmailVerified: true,
    },
  });
});

describe('ChatScreen', () => {
  it('renders own and counterparty messages', async () => {
    seedStore(
      [
        message({
          id: 'srv-1',
          senderId: 'user-other',
          body: 'from them',
          sequenceNumber: 1,
          clientMessageId: 'cmid-1',
        }),
        message({
          id: 'srv-2',
          senderId: CURRENT_USER_ID,
          body: 'from me',
          sequenceNumber: 2,
          clientMessageId: 'cmid-2',
        }),
      ],
      conversation(),
    );

    await renderScreen();

    expect(screen.getByText('from them')).toBeTruthy();
    expect(screen.getByText('from me')).toBeTruthy();
  });

  it('shows the failed send-state affordance for an own optimistic message', async () => {
    seedStore(
      [
        message({
          id: 'local:cmid-9',
          senderId: null,
          clientMessageId: 'cmid-9',
          body: 'pending',
          sequenceNumber: Number.MAX_SAFE_INTEGER,
          sendState: 'failed',
        }),
      ],
      conversation(),
    );

    await renderScreen();

    expect(screen.getByTestId('chat-message-state-local:cmid-9')).toBeTruthy();
    expect(screen.getByText('chat.state.failed')).toBeTruthy();
  });

  it('hides the composer and shows the closed notice when the conversation is CLOSED', async () => {
    seedStore([message({})], conversation({ status: 'CLOSED' }));

    await renderScreen();

    expect(screen.getByTestId('chat-closed-notice')).toBeTruthy();
    expect(screen.queryByTestId('chat-composer-input')).toBeNull();
  });

  it('renders the empty state when there are no messages', async () => {
    seedStore([], conversation());

    await renderScreen();

    expect(screen.getByTestId('chat-empty')).toBeTruthy();
  });
});


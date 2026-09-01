/**
 * ChatScreen — the conversation view for a matched Host↔Cleaner pair.
 *
 * Composes the chat store (state + actions) with the realtime hook (`useChatChannel`) and the
 * presentational components (header, message list, composer). The store is the single source of
 * message state; the hook only feeds incoming messages and drives reconciliation. History renders
 * oldest→newest (inverted list keeps the latest in view); own vs counterparty is decided by the
 * authenticated user's id. Sends are optimistic via the store. All copy comes from i18n.
 *
 * @requirements 6.3, 6.5
 */

import React, { useCallback, useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../stores/auth.store';
import { ConversationHeader } from './components/ConversationHeader';
import { MessageBubble } from './components/MessageBubble';
import { MessageComposer } from './components/MessageComposer';
import { CHAT_I18N_KEYS } from './chat.constants';
import { useChatStore } from './chat.store';
import { useChatChannel } from './useChatChannel';
import type { ChatMessage } from './chat.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  accent: '#00F5D4',
  textMuted: 'rgba(255, 255, 255, 0.5)',
} as const;

const SPACING = {
  md: 16,
  xl: 32,
} as const;

const FONT_SIZE = {
  body: 15,
} as const;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ChatScreenProps {
  route: { params: { conversationId: string } };
  navigation: { goBack: () => void };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatScreen({ route, navigation }: ChatScreenProps): React.JSX.Element {
  const { conversationId } = route.params;
  const { t } = useTranslation();

  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  const messages = useChatStore((state) => state.messagesByConversation.get(conversationId));
  const conversation = useChatStore((state) => state.conversations.get(conversationId));
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const error = useChatStore((state) => state.error);

  const loadConversationMessages = useChatStore((state) => state.loadConversationMessages);
  const loadOlder = useChatStore((state) => state.loadOlder);
  const reconcileNewer = useChatStore((state) => state.reconcileNewer);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const onIncomingMessage = useChatStore((state) => state.onIncomingMessage);
  const setConnectionStatus = useChatStore((state) => state.setConnectionStatus);

  // Load the latest history page on mount.
  useEffect(() => {
    loadConversationMessages(conversationId);
  }, [conversationId, loadConversationMessages]);

  // Wire the realtime channel: incoming messages + status + reconcile on (re)connect.
  useChatChannel({
    conversationId,
    onMessage: onIncomingMessage,
    onConnectionChange: setConnectionStatus,
    onReconcile: reconcileNewer,
  });

  const isClosed = conversation?.status === 'CLOSED';
  const orderedMessages = messages ?? [];

  const handleSend = useCallback(
    (body: string) => {
      sendMessage(conversationId, body);
    },
    [conversationId, sendMessage],
  );

  const handleLoadOlder = useCallback(() => {
    loadOlder(conversationId);
  }, [conversationId, loadOlder]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => (
      <MessageBubble message={item} isOwn={isOwnMessage(item, currentUserId)} />
    ),
    [currentUserId],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID="chat-screen">
      <ConversationHeader connectionStatus={connectionStatus} onBack={navigation.goBack} />

      {error !== null && (
        <Text style={styles.errorBanner} testID="chat-error">
          {t(error)}
        </Text>
      )}

      <FlatList
        style={styles.list}
        data={orderedMessages}
        keyExtractor={keyForMessage}
        renderItem={renderItem}
        inverted={false}
        onEndReached={handleLoadOlder}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState label={t(CHAT_I18N_KEYS.EMPTY)} />}
        testID="chat-message-list"
      />

      {isClosed ? (
        <Text style={styles.closedNotice} testID="chat-closed-notice">
          {t(CHAT_I18N_KEYS.CLOSED_NOTICE)}
        </Text>
      ) : (
        <MessageComposer onSend={handleSend} disabled={isClosed} />
      )}
    </SafeAreaView>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Own when the sender is the current user, or when it is a local optimistic send (null sender). */
function isOwnMessage(message: ChatMessage, currentUserId: string | null): boolean {
  if (message.sendState !== undefined) {
    return true;
  }
  return currentUserId !== null && message.senderId === currentUserId;
}

function keyForMessage(message: ChatMessage): string {
  return message.id;
}

function EmptyState({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.emptyContainer} testID="chat-empty">
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: SPACING.md,
    flexGrow: 1,
  },
  errorBanner: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.body,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    textAlign: 'center',
  },
  closedNotice: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.body,
    padding: SPACING.md,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.body,
    textAlign: 'center',
  },
});

export default ChatScreen;

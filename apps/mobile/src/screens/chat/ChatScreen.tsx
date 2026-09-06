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

import React, { useCallback, useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../stores/auth.store';
import { ConversationHeader } from './components/ConversationHeader';
import { MessageBubble } from './components/MessageBubble';
import { MessageComposer } from './components/MessageComposer';
import { VoiceNotePlayer } from './components/VoiceNotePlayer';
import { CHAT_I18N_KEYS } from './chat.constants';
import { useChatStore } from './chat.store';
import { useChatChannel } from './useChatChannel';
import type { ChatMessage, RecordedClip } from './chat.types';
// --- voip-calls integration (Spec 15) ---
import { CallAffordance } from './voip/components/CallAffordance';
import { IncomingCallSheet } from './voip/components/IncomingCallSheet';
import { InCallScreen } from './voip/InCallScreen';
import { useCallSignaling } from './voip/useCallSignaling';
import { useVoipStore } from './voip/voip.store';

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
  const sendVoiceNote = useChatStore((state) => state.sendVoiceNote);
  const onIncomingMessage = useChatStore((state) => state.onIncomingMessage);
  const applyTranscriptUpdate = useChatStore((state) => state.applyTranscriptUpdate);
  const setConnectionStatus = useChatStore((state) => state.setConnectionStatus);

  // Load the latest history page on mount.
  useEffect(() => {
    loadConversationMessages(conversationId);
  }, [conversationId, loadConversationMessages]);

  // Wire the realtime channel: incoming messages + transcript updates + status + reconcile.
  useChatChannel({
    conversationId,
    onMessage: onIncomingMessage,
    onTranscriptUpdate: applyTranscriptUpdate,
    onConnectionChange: setConnectionStatus,
    onReconcile: reconcileNewer,
  });

  // --- voip-calls: route call-control signals off the same conversation channel + load the log ---
  const applyCallSignal = useVoipStore((state) => state.applySignal);
  const loadCallLog = useVoipStore((state) => state.loadCallLog);
  useCallSignaling({ conversationId, onSignal: applyCallSignal });
  useEffect(() => {
    loadCallLog(conversationId);
  }, [conversationId, loadCallLog]);

  const isClosed = conversation?.status === 'CLOSED';
  const orderedMessages = messages ?? [];
  // The store keeps messages ascending (oldest→newest). The inverted list renders newest at the
  // bottom, so feed it a newest-first copy.
  const displayMessages = useMemo(() => [...orderedMessages].reverse(), [orderedMessages]);

  const handleSend = useCallback(
    (body: string) => {
      sendMessage(conversationId, body);
    },
    [conversationId, sendMessage],
  );

  const handleSendVoice = useCallback(
    (clip: RecordedClip) => {
      // Waveform capture is deferred; send null (player synthesizes a visual).
      sendVoiceNote(conversationId, clip, null);
    },
    [conversationId, sendVoiceNote],
  );

  const handleLoadOlder = useCallback(() => {
    loadOlder(conversationId);
  }, [conversationId, loadOlder]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => {
      const own = isOwnMessage(item, currentUserId);
      if (item.type === 'VOICE') {
        return <VoiceNotePlayer message={item} isOwn={own} />;
      }
      return <MessageBubble message={item} isOwn={own} />;
    },
    [currentUserId],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID="chat-screen">
      <ConversationHeader connectionStatus={connectionStatus} onBack={navigation.goBack} />

      <View style={styles.callBar}>
        <CallAffordance conversationId={conversationId} isOpen={!isClosed} />
      </View>

      {error !== null && (
        <Text style={styles.errorBanner} testID="chat-error">
          {t(error)}
        </Text>
      )}

      <FlatList
        style={styles.list}
        data={displayMessages}
        keyExtractor={keyForMessage}
        renderItem={renderItem}
        // Inverted: newest renders at the bottom; `onEndReached` fires at the top (older history),
        // which is exactly where backward pagination belongs. Data is newest-first to match.
        inverted={displayMessages.length > 0}
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
        <MessageComposer onSend={handleSend} onSendVoice={handleSendVoice} disabled={isClosed} />
      )}

      {/* Call overlays: incoming-call sheet + the outgoing/active/ended in-call screen. */}
      <IncomingCallSheet />
      <InCallScreen />
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
  callBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
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

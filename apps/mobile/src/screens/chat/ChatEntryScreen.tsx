/**
 * ChatEntryScreen — resolves a matched thread into a conversation, then renders the chat.
 *
 * Navigation entry points (Host Offers stack, Cleaner Active stack) route here with a `threadId`.
 * This container calls the store's open-or-get action (idempotent; only succeeds for a matched
 * thread) to obtain the conversation id, then mounts `ChatScreen`. Keeping the resolve step here
 * lets `ChatScreen` stay focused on rendering a known conversation. All copy comes from i18n.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from './ChatScreen';
import { CHAT_I18N_KEYS } from './chat.constants';
import { useChatStore } from './chat.store';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  accent: '#00F5D4',
  textMuted: 'rgba(255, 255, 255, 0.5)',
} as const;

const SPACING = {
  xl: 32,
} as const;

const FONT_SIZE = {
  body: 15,
} as const;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ChatEntryScreenProps {
  route: { params: { threadId: string } };
  navigation: { goBack: () => void };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatEntryScreen({ route, navigation }: ChatEntryScreenProps): React.JSX.Element {
  const { threadId } = route.params;
  const { t } = useTranslation();

  const openConversation = useChatStore((state) => state.openConversation);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void openConversation(threadId).then((conversation) => {
      if (cancelled) {
        return;
      }
      if (conversation === null) {
        setFailed(true);
        return;
      }
      setConversationId(conversation.id);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, openConversation]);

  if (failed) {
    return (
      <SafeAreaView style={styles.centered} testID="chat-entry-error">
        <Text style={styles.errorText}>{t(CHAT_I18N_KEYS.LOAD_ERROR)}</Text>
      </SafeAreaView>
    );
  }

  if (conversationId === null) {
    return (
      <SafeAreaView style={styles.centered} testID="chat-entry-loading">
        <ActivityIndicator size="large" color={COLORS.accent} />
      </SafeAreaView>
    );
  }

  return (
    <ChatScreen route={{ params: { conversationId } }} navigation={navigation} />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  errorText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.body,
    textAlign: 'center',
  },
});

export default ChatEntryScreen;

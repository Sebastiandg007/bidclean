/**
 * MessageComposer — the compose-and-send input at the bottom of a conversation.
 *
 * A single-line-growing text input plus a send button. Enforces the client-side max length as a
 * fast pre-check (the backend remains authoritative). Disabled when the conversation is closed or
 * the body is empty/whitespace. Sending clears the input; the store handles the optimistic insert.
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CHAT_I18N_KEYS, CHAT_MESSAGE_MAX_LENGTH } from '../chat.constants';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  accent: '#00F5D4',
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  textOnAccent: '#0B0C10',
  textMuted: 'rgba(255, 255, 255, 0.4)',
  disabled: 'rgba(0, 245, 212, 0.35)',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  body: 15,
  button: 15,
} as const;

const INPUT_RADIUS = 20;
const INPUT_MIN_HEIGHT = 44;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MessageComposerProps {
  /** Send the trimmed body; the parent delegates to the store's optimistic send. */
  onSend: (body: string) => void;
  /** When true, the composer is disabled (conversation closed). */
  disabled?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MessageComposer({ onSend, disabled = false }: MessageComposerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const trimmed = draft.trim();
  const canSend = !disabled && trimmed.length > 0;

  const handleSend = useCallback(() => {
    if (!canSend) {
      return;
    }
    onSend(trimmed);
    setDraft('');
  }, [canSend, onSend, trimmed]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        editable={!disabled}
        multiline
        maxLength={CHAT_MESSAGE_MAX_LENGTH}
        placeholder={t(CHAT_I18N_KEYS.COMPOSER_PLACEHOLDER)}
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel={t(CHAT_I18N_KEYS.COMPOSER_PLACEHOLDER)}
        testID="chat-composer-input"
      />
      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel={t(CHAT_I18N_KEYS.SEND)}
        accessibilityState={{ disabled: !canSend }}
        testID="chat-composer-send"
      >
        <Text style={styles.sendText}>{t(CHAT_I18N_KEYS.SEND)}</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    backgroundColor: COLORS.card,
  },
  input: {
    flex: 1,
    minHeight: INPUT_MIN_HEIGHT,
    borderRadius: INPUT_RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  sendButton: {
    minHeight: INPUT_MIN_HEIGHT,
    paddingHorizontal: SPACING.md,
    borderRadius: INPUT_RADIUS,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  sendText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.textOnAccent,
  },
});

export default MessageComposer;

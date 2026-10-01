/**
 * MessageComposer — the compose-and-send input at the bottom of a conversation.
 *
 * A single-line-growing text input plus a send button. Enforces the client-side max length as a
 * fast pre-check (the backend remains authoritative). Disabled when the conversation is closed or
 * the body is empty/whitespace. Sending clears the input; the store handles the optimistic insert.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CHAT_I18N_KEYS, CHAT_MESSAGE_MAX_LENGTH } from '../chat.constants';
import { useVoiceRecorder } from '../useVoiceRecorder';
import type { RecordedClip } from '../chat.types';
import { makeStyles, useTheme } from '../../../theme';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Format elapsed milliseconds as m:ss for the recording indicator. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Design Tokens ───────────────────────────────────────────────────────────

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
  /** Send a recorded voice note; the parent delegates to the store's optimistic voice send. */
  onSendVoice?: (clip: RecordedClip) => void;
  /** When true, the composer is disabled (conversation closed). */
  disabled?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MessageComposer({
  onSend,
  onSendVoice,
  disabled = false,
}: MessageComposerProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { theme } = useTheme();
  const [draft, setDraft] = useState('');
  const recorder = useVoiceRecorder();

  const trimmed = draft.trim();
  const canSend = !disabled && trimmed.length > 0;
  const voiceEnabled = !disabled && onSendVoice !== undefined;

  const handleSend = useCallback(() => {
    if (!canSend) {
      return;
    }
    onSend(trimmed);
    setDraft('');
  }, [canSend, onSend, trimmed]);

  const handleSendVoice = useCallback(() => {
    if (recorder.clip !== null && onSendVoice !== undefined) {
      onSendVoice(recorder.clip);
      recorder.discard();
    }
  }, [onSendVoice, recorder]);

  // Auto-discard a stale clip if the composer becomes disabled (conversation closed mid-preview).
  useEffect(() => {
    if (disabled && recorder.phase !== 'idle') {
      recorder.discard();
    }
  }, [disabled, recorder]);

  // ── Recording in progress ──
  if (recorder.phase === 'recording') {
    return (
      <View style={styles.container} testID="chat-composer-recording">
        <Text style={styles.recordingLabel}>
          {t(CHAT_I18N_KEYS.VOICE_RECORDING)} {formatElapsed(recorder.elapsedMs)}
        </Text>
        <Pressable
          onPress={recorder.stop}
          style={styles.sendButton}
          accessibilityRole="button"
          accessibilityLabel={t(CHAT_I18N_KEYS.VOICE_STOP)}
          testID="chat-composer-stop"
        >
          <Text style={styles.sendText}>{t(CHAT_I18N_KEYS.VOICE_STOP)}</Text>
        </Pressable>
      </View>
    );
  }

  // ── Recorded clip preview (send / discard) ──
  if (recorder.phase === 'recorded' && recorder.clip !== null) {
    return (
      <View style={styles.container} testID="chat-composer-preview">
        <Pressable
          onPress={recorder.discard}
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel={t(CHAT_I18N_KEYS.VOICE_PREVIEW_DISCARD)}
          testID="chat-composer-discard"
        >
          <Text style={styles.secondaryText}>{t(CHAT_I18N_KEYS.VOICE_PREVIEW_DISCARD)}</Text>
        </Pressable>
        <Text style={styles.recordingLabel}>{formatElapsed(recorder.clip.durationMs)}</Text>
        <Pressable
          onPress={handleSendVoice}
          style={styles.sendButton}
          accessibilityRole="button"
          accessibilityLabel={t(CHAT_I18N_KEYS.VOICE_PREVIEW_SEND)}
          testID="chat-composer-voice-send"
        >
          <Text style={styles.sendText}>{t(CHAT_I18N_KEYS.VOICE_PREVIEW_SEND)}</Text>
        </Pressable>
      </View>
    );
  }

  // ── Idle: text input + record + send ──
  return (
    <View style={styles.container}>
      {recorder.error !== null && (
        <Text style={styles.errorText} testID="chat-composer-voice-error">
          {t(recorder.error)}
        </Text>
      )}
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        editable={!disabled}
        multiline
        maxLength={CHAT_MESSAGE_MAX_LENGTH}
        placeholder={t(CHAT_I18N_KEYS.COMPOSER_PLACEHOLDER)}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={t(CHAT_I18N_KEYS.COMPOSER_PLACEHOLDER)}
        testID="chat-composer-input"
      />
      {voiceEnabled && trimmed.length === 0 ? (
        <Pressable
          onPress={recorder.start}
          style={styles.recordButton}
          accessibilityRole="button"
          accessibilityLabel={t(CHAT_I18N_KEYS.VOICE_RECORD)}
          testID="chat-composer-record"
        >
          <Text style={styles.recordIcon}>●</Text>
        </Pressable>
      ) : (
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
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    backgroundColor: theme.surface,
  },
  input: {
    flex: 1,
    minHeight: INPUT_MIN_HEIGHT,
    borderRadius: INPUT_RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: theme.textPrimary,
    fontSize: FONT_SIZE.body,
    backgroundColor: theme.surfaceElevated,
  },
  sendButton: {
    minHeight: INPUT_MIN_HEIGHT,
    paddingHorizontal: SPACING.md,
    borderRadius: INPUT_RADIUS,
    backgroundColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: theme.surfaceElevated,
  },
  sendText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: theme.onAccent,
  },
  recordButton: {
    minHeight: INPUT_MIN_HEIGHT,
    width: INPUT_MIN_HEIGHT,
    borderRadius: INPUT_RADIUS,
    backgroundColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordIcon: {
    fontSize: FONT_SIZE.button + 3,
    color: theme.onAccent,
  },
  secondaryButton: {
    minHeight: INPUT_MIN_HEIGHT,
    paddingHorizontal: SPACING.md,
    borderRadius: INPUT_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.surfaceElevated,
  },
  secondaryText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  recordingLabel: {
    flex: 1,
    fontSize: FONT_SIZE.body,
    color: theme.textPrimary,
    textAlign: 'center',
  },
  errorText: {
    position: 'absolute',
    top: -SPACING.md - 4,
    left: SPACING.md,
    right: SPACING.md,
    fontSize: 12,
    color: theme.danger,
  },
}));

export default MessageComposer;

/**
 * MessageBubble — a single chat message row.
 *
 * Renders the message body aligned by ownership (own messages right + accent, counterparty left +
 * card), and surfaces the local send state (sending / failed) for own optimistic messages. Server
 * messages carry no `sendState` and show no status affordance. All copy comes from i18n.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CHAT_I18N_KEYS } from '../chat.constants';
import type { ChatMessage } from '../chat.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  accent: '#00F5D4',
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  textOnAccent: '#0B0C10',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  failed: '#FF6B6B',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  body: 15,
  caption: 11,
} as const;

const BUBBLE_RADIUS = 16;
const BUBBLE_MAX_WIDTH = '80%';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Whether the message was sent by the current user (drives alignment + color). */
  isOwn: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MessageBubble({ message, isOwn }: MessageBubbleProps): React.JSX.Element {
  const { t } = useTranslation();

  const stateLabel = ((): string | null => {
    if (!isOwn || message.sendState === undefined) {
      return null;
    }
    if (message.sendState === 'sending') {
      return t(CHAT_I18N_KEYS.STATE_SENDING);
    }
    if (message.sendState === 'failed') {
      return t(CHAT_I18N_KEYS.STATE_FAILED);
    }
    return t(CHAT_I18N_KEYS.STATE_SENT);
  })();

  const isFailed = message.sendState === 'failed';

  return (
    <View
      style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}
      testID={`chat-message-${message.id}`}
    >
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={[styles.body, isOwn && styles.bodyOwn]}>{message.body}</Text>
      </View>
      {stateLabel !== null && (
        <Text
          style={[styles.state, isFailed && styles.stateFailed]}
          testID={`chat-message-state-${message.id}`}
        >
          {stateLabel}
        </Text>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    marginVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    maxWidth: BUBBLE_MAX_WIDTH,
  },
  rowOwn: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: BUBBLE_RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  bubbleOwn: {
    backgroundColor: COLORS.accent,
  },
  bubbleOther: {
    backgroundColor: COLORS.card,
  },
  body: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
  },
  bodyOwn: {
    color: COLORS.textOnAccent,
  },
  state: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  stateFailed: {
    color: COLORS.failed,
  },
});

export default MessageBubble;

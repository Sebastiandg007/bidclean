/**
 * ConversationHeader — top bar for a conversation.
 *
 * Shows a back affordance, the conversation title, and a small connection-status indicator so the
 * user understands realtime state (connected / connecting / reconnecting / offline). All copy comes
 * from i18n; no message content is shown here.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CHAT_I18N_KEYS } from '../chat.constants';
import type { ConnectionStatus } from '../chat.types';
import { makeStyles, useTheme } from '../../../theme';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  title: 18,
  caption: 11,
  backIcon: 20,
} as const;

const BACK_BUTTON_SIZE = 36;
const DOT_SIZE = 8;

const CONNECTION_LABEL_KEYS: Record<ConnectionStatus, string> = {
  connected: CHAT_I18N_KEYS.CONNECTION_CONNECTED,
  connecting: CHAT_I18N_KEYS.CONNECTION_CONNECTING,
  reconnecting: CHAT_I18N_KEYS.CONNECTION_RECONNECTING,
  disconnected: CHAT_I18N_KEYS.CONNECTION_DISCONNECTED,
};

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ConversationHeaderProps {
  connectionStatus: ConnectionStatus;
  onBack: () => void;
  /** Optional override title; defaults to the generic chat header. */
  title?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConversationHeader({
  connectionStatus,
  onBack,
  title,
}: ConversationHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { theme } = useTheme();
  const isConnected = connectionStatus === 'connected';

  return (
    <View style={styles.header} testID="chat-header">
      <Pressable
        onPress={onBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel={t(CHAT_I18N_KEYS.HEADER_TITLE)}
        testID="chat-header-back"
      >
        <Text style={styles.backIcon}>←</Text>
      </Pressable>

      <Text style={styles.title} numberOfLines={1}>
        {title ?? t(CHAT_I18N_KEYS.HEADER_TITLE)}
      </Text>

      <View style={styles.status} testID="chat-connection-status">
        <View
          style={[styles.dot, { backgroundColor: isConnected ? theme.accent : theme.danger }]}
        />
        <Text style={styles.statusLabel}>{t(CONNECTION_LABEL_KEYS[connectionStatus])}</Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: theme.background,
    gap: SPACING.sm,
  },
  backButton: {
    width: BACK_BUTTON_SIZE,
    height: BACK_BUTTON_SIZE,
    borderRadius: BACK_BUTTON_SIZE / 2,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: FONT_SIZE.backIcon,
    color: theme.textPrimary,
  },
  title: {
    flex: 1,
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  statusLabel: {
    fontSize: FONT_SIZE.caption,
    color: theme.textMuted,
  },
}));

export default ConversationHeader;

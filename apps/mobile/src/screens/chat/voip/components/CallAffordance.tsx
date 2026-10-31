/**
 * CallAffordance — the chat-header call button(s) that initiate a call (Spec 15).
 *
 * Offered only while the conversation is OPEN. Voice always; video only when the client video flag
 * is enabled (the server remains authoritative and degrades to audio if disabled). Initiating hands
 * off to the store, which persists RINGING first, mints the initiator token, and publishes the
 * invite. All copy is i18n; BidClean dark tokens.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { VOIP_I18N_KEYS, VOIP_VIDEO_ENABLED } from '../voip.constants';
import { useVoipStore } from '../voip.store';
import { VOIP_COLORS, VOIP_FONT_SIZE, VOIP_SPACING } from './voip.tokens';

export interface CallAffordanceProps {
  conversationId: string;
  /** Whether the conversation is OPEN (calling is disabled on CLOSED). */
  isOpen: boolean;
}

export function CallAffordance({
  conversationId,
  isOpen,
}: CallAffordanceProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const initiate = useVoipStore((state) => state.initiate);
  const activeCall = useVoipStore((state) => state.activeCall);

  const hasActiveCall =
    activeCall !== null &&
    (activeCall.phase === 'outgoing' ||
      activeCall.phase === 'incoming' ||
      activeCall.phase === 'active');

  const startVoice = useCallback(() => {
    void initiate(conversationId, 'AUDIO');
  }, [conversationId, initiate]);

  const startVideo = useCallback(() => {
    void initiate(conversationId, 'VIDEO');
  }, [conversationId, initiate]);

  if (!isOpen) {
    return null;
  }

  return (
    <View style={styles.container} testID="voip-call-affordance">
      <Pressable
        onPress={startVoice}
        disabled={hasActiveCall}
        style={[styles.button, hasActiveCall && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={t(VOIP_I18N_KEYS.CALL_VOICE)}
        testID="voip-start-voice"
      >
        <Text style={styles.icon}>☎</Text>
      </Pressable>
      {VOIP_VIDEO_ENABLED && (
        <Pressable
          onPress={startVideo}
          disabled={hasActiveCall}
          style={[styles.button, hasActiveCall && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel={t(VOIP_I18N_KEYS.CALL_VIDEO)}
          testID="voip-start-video"
        >
          <Text style={styles.icon}>🎥</Text>
        </Pressable>
      )}
    </View>
  );
}

const BUTTON_SIZE = 36;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: VOIP_SPACING.sm,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: VOIP_COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: VOIP_FONT_SIZE.icon,
    color: VOIP_COLORS.accent,
  },
});

export default CallAffordance;

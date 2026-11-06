/**
 * IncomingCallSheet — the accept/decline UI for an incoming call (Spec 15).
 *
 * Presented while the active call is in the `incoming` phase (a `call_invite` arrived, or push
 * deep-linked one via `NotificationRouter.openIncomingCall` → `voip.store.openIncoming`). Foreground
 * only: waking a backgrounded/killed app is deferred to push-notifications (Spec 16). Accept moves
 * the call to `active` (mints the callee token); decline transitions it terminal. All copy is i18n;
 * BidClean dark tokens.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { VOIP_I18N_KEYS } from '../voip.constants';
import { useVoipStore } from '../voip.store';
import { VOIP_COLORS, VOIP_FONT_SIZE, VOIP_SPACING } from './voip.tokens';

export function IncomingCallSheet(): React.JSX.Element | null {
  const { t } = useTranslation();
  const activeCall = useVoipStore((state) => state.activeCall);
  const answer = useVoipStore((state) => state.answer);
  const decline = useVoipStore((state) => state.decline);

  if (!activeCall || activeCall.phase !== 'incoming') {
    return null;
  }

  const isVideo = activeCall.call.mediaKind === 'VIDEO';

  return (
    <Modal transparent animationType="slide" visible testID="voip-incoming-sheet">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t(VOIP_I18N_KEYS.INCOMING_TITLE)}</Text>
          <Text style={styles.subtitle}>
            {t(isVideo ? VOIP_I18N_KEYS.CALL_VIDEO : VOIP_I18N_KEYS.CALL_VOICE)}
          </Text>

          <View style={styles.actions}>
            <Pressable
              onPress={decline}
              style={[styles.button, styles.decline]}
              accessibilityRole="button"
              accessibilityLabel={t(VOIP_I18N_KEYS.DECLINE)}
              testID="voip-incoming-decline"
            >
              <Text style={styles.buttonLabel}>{t(VOIP_I18N_KEYS.DECLINE)}</Text>
            </Pressable>
            <Pressable
              onPress={answer}
              style={[styles.button, styles.accept]}
              accessibilityRole="button"
              accessibilityLabel={t(VOIP_I18N_KEYS.ACCEPT)}
              testID="voip-incoming-accept"
            >
              <Text style={[styles.buttonLabel, styles.acceptLabel]}>
                {t(VOIP_I18N_KEYS.ACCEPT)}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: VOIP_COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: VOIP_COLORS.card,
    borderTopLeftRadius: VOIP_SPACING.lg,
    borderTopRightRadius: VOIP_SPACING.lg,
    padding: VOIP_SPACING.xl,
    alignItems: 'center',
    gap: VOIP_SPACING.sm,
  },
  title: {
    fontSize: VOIP_FONT_SIZE.title,
    fontWeight: '700',
    color: VOIP_COLORS.textPrimary,
  },
  subtitle: {
    fontSize: VOIP_FONT_SIZE.body,
    color: VOIP_COLORS.textMuted,
    marginBottom: VOIP_SPACING.lg,
  },
  actions: {
    flexDirection: 'row',
    gap: VOIP_SPACING.md,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: VOIP_SPACING.md,
    borderRadius: VOIP_SPACING.md,
    alignItems: 'center',
  },
  decline: {
    backgroundColor: VOIP_COLORS.danger,
  },
  accept: {
    backgroundColor: VOIP_COLORS.accent,
  },
  buttonLabel: {
    fontSize: VOIP_FONT_SIZE.body,
    fontWeight: '700',
    color: VOIP_COLORS.textPrimary,
  },
  acceptLabel: {
    color: VOIP_COLORS.background,
  },
});

export default IncomingCallSheet;

/**
 * InCallScreen — the active/outgoing/ended call surface (Spec 15).
 *
 * Renders whichever active-call phase is live:
 *   - `outgoing`: our ringing call with a cancel action;
 *   - `active`: the ONGOING call — elapsed duration + controls (mute, speaker, end; camera when
 *     video), driven by `useLiveKitRoom`; degrades to audio-only gracefully;
 *   - `ended`: a brief terminal summary, then the caller dismisses.
 *
 * Media is owned by `useLiveKitRoom` (LiveKit SFU); this screen never touches RTP. A mic/camera
 * permission denial surfaces an i18n notice and never crashes or blocks chat. All copy is i18n;
 * BidClean dark tokens.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { VOIP_DURATION_TICK_MS, VOIP_I18N_KEYS } from './voip.constants';
import { useVoipStore } from './voip.store';
import { useLiveKitRoom } from './useLiveKitRoom';
import { VOIP_COLORS, VOIP_FONT_SIZE, VOIP_SPACING } from './components/voip.tokens';

/** Format an elapsed seconds count as m:ss (or h:mm:ss beyond an hour). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function InCallScreen(): React.JSX.Element | null {
  const { t } = useTranslation();

  const activeCall = useVoipStore((state) => state.activeCall);
  const cancel = useVoipStore((state) => state.cancel);
  const end = useVoipStore((state) => state.end);
  const dismissActive = useVoipStore((state) => state.dismissActive);
  const refreshMediaToken = useVoipStore((state) => state.refreshMediaToken);

  const media = activeCall?.media ?? null;
  const mediaKind = activeCall?.call.mediaKind ?? 'AUDIO';

  const room = useLiveKitRoom({
    media: activeCall?.phase === 'active' ? media : null,
    mediaKind,
    onRequestFreshToken: refreshMediaToken,
  });

  const answeredAt = activeCall?.call.answeredAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Tick the elapsed timer while ONGOING, anchored to the server's answeredAt.
  useEffect(() => {
    if (activeCall?.phase !== 'active' || answeredAt === null) {
      setElapsedSeconds(0);
      return;
    }
    const answeredMs = new Date(answeredAt).getTime();
    const tick = (): void => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - answeredMs) / 1000)));
    };
    tick();
    const interval = setInterval(tick, VOIP_DURATION_TICK_MS);
    return () => clearInterval(interval);
  }, [activeCall?.phase, answeredAt]);

  const statusLabel = useMemo(() => {
    if (!activeCall) {
      return '';
    }
    if (activeCall.phase === 'outgoing') {
      return t(VOIP_I18N_KEYS.RINGING_OUTGOING);
    }
    if (activeCall.phase === 'active') {
      if (room.connectionState === 'connecting') {
        return t(VOIP_I18N_KEYS.CONNECTING);
      }
      return formatDuration(elapsedSeconds);
    }
    return t(VOIP_I18N_KEYS.LOG_ENDED);
  }, [activeCall, room.connectionState, elapsedSeconds, t]);

  if (!activeCall || activeCall.phase === 'idle' || activeCall.phase === 'incoming') {
    return null;
  }

  const isOutgoing = activeCall.phase === 'outgoing';
  const isActive = activeCall.phase === 'active';
  const isEnded = activeCall.phase === 'ended';

  return (
    <Modal transparent={false} animationType="fade" visible testID="voip-in-call-screen">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.kind}>
            {t(mediaKind === 'VIDEO' ? VOIP_I18N_KEYS.CALL_VIDEO : VOIP_I18N_KEYS.CALL_VOICE)}
          </Text>
          <Text style={styles.status} testID="voip-in-call-status">
            {statusLabel}
          </Text>
          {room.isAudioOnly && mediaKind === 'VIDEO' && (
            <Text style={styles.notice} testID="voip-audio-only">
              {t(VOIP_I18N_KEYS.AUDIO_ONLY)}
            </Text>
          )}
          {room.notice !== null && (
            <Text style={styles.notice} testID="voip-media-notice">
              {t(room.notice)}
            </Text>
          )}
        </View>

        <View style={styles.controls}>
          {isActive && (
            <>
              <ControlButton
                label={t(room.isMuted ? VOIP_I18N_KEYS.UNMUTE : VOIP_I18N_KEYS.MUTE)}
                onPress={room.toggleMute}
                testID="voip-control-mute"
              />
              <ControlButton
                label={t(VOIP_I18N_KEYS.SPEAKER)}
                onPress={room.toggleSpeaker}
                active={room.isSpeakerOn}
                testID="voip-control-speaker"
              />
              {!room.isAudioOnly && (
                <ControlButton
                  label={t(room.isCameraOn ? VOIP_I18N_KEYS.CAMERA_OFF : VOIP_I18N_KEYS.CAMERA_ON)}
                  onPress={room.toggleCamera}
                  testID="voip-control-camera"
                />
              )}
            </>
          )}
        </View>

        <View style={styles.footer}>
          {isOutgoing && (
            <Pressable
              onPress={cancel}
              style={[styles.endButton]}
              accessibilityRole="button"
              accessibilityLabel={t(VOIP_I18N_KEYS.CANCEL)}
              testID="voip-cancel"
            >
              <Text style={styles.endLabel}>{t(VOIP_I18N_KEYS.CANCEL)}</Text>
            </Pressable>
          )}
          {isActive && (
            <Pressable
              onPress={end}
              style={[styles.endButton]}
              accessibilityRole="button"
              accessibilityLabel={t(VOIP_I18N_KEYS.END)}
              testID="voip-end"
            >
              <Text style={styles.endLabel}>{t(VOIP_I18N_KEYS.END)}</Text>
            </Pressable>
          )}
          {isEnded && (
            <Pressable
              onPress={dismissActive}
              style={[styles.dismissButton]}
              accessibilityRole="button"
              accessibilityLabel={t(VOIP_I18N_KEYS.END)}
              testID="voip-dismiss"
            >
              <Text style={styles.dismissLabel}>{t(VOIP_I18N_KEYS.END)}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

interface ControlButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  active?: boolean;
  testID: string;
}

function ControlButton({ label, onPress, active, testID }: ControlButtonProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.control, active === true && styles.controlActive]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VOIP_COLORS.background,
    justifyContent: 'space-between',
    paddingVertical: VOIP_SPACING.xl,
    paddingHorizontal: VOIP_SPACING.lg,
  },
  header: {
    alignItems: 'center',
    gap: VOIP_SPACING.sm,
    marginTop: VOIP_SPACING.xl,
  },
  kind: {
    fontSize: VOIP_FONT_SIZE.body,
    color: VOIP_COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  status: {
    fontSize: VOIP_FONT_SIZE.duration,
    fontWeight: '700',
    color: VOIP_COLORS.textPrimary,
  },
  notice: {
    fontSize: VOIP_FONT_SIZE.caption,
    color: VOIP_COLORS.accent,
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: VOIP_SPACING.md,
    flexWrap: 'wrap',
  },
  control: {
    paddingVertical: VOIP_SPACING.md,
    paddingHorizontal: VOIP_SPACING.lg,
    borderRadius: VOIP_SPACING.md,
    backgroundColor: VOIP_COLORS.card,
  },
  controlActive: {
    borderWidth: 1,
    borderColor: VOIP_COLORS.accent,
  },
  controlLabel: {
    fontSize: VOIP_FONT_SIZE.body,
    color: VOIP_COLORS.textPrimary,
  },
  footer: {
    alignItems: 'center',
  },
  endButton: {
    backgroundColor: VOIP_COLORS.danger,
    paddingVertical: VOIP_SPACING.md,
    paddingHorizontal: VOIP_SPACING.xl,
    borderRadius: VOIP_SPACING.xl,
  },
  endLabel: {
    fontSize: VOIP_FONT_SIZE.body,
    fontWeight: '700',
    color: VOIP_COLORS.textPrimary,
  },
  dismissButton: {
    backgroundColor: VOIP_COLORS.card,
    paddingVertical: VOIP_SPACING.md,
    paddingHorizontal: VOIP_SPACING.xl,
    borderRadius: VOIP_SPACING.xl,
  },
  dismissLabel: {
    fontSize: VOIP_FONT_SIZE.body,
    fontWeight: '700',
    color: VOIP_COLORS.textPrimary,
  },
});

export default InCallScreen;

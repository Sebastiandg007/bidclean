/**
 * VoiceNotePlayer — plays a voice-note clip and renders its transcript state (Spec 14).
 *
 * Play/pause with a duration + progress indicator and an optional waveform, styled by ownership
 * (own = accent, counterparty = card). Playback NEVER depends on the transcript: the transcript is
 * shown when READY, a subtle "transcribing" hint when PENDING, and an unobtrusive fallback when
 * FAILED/DISABLED. A fresh short-lived playback URL is fetched on demand the first time the user
 * plays (own optimistic sends can play the local file uri). All copy comes from i18n.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';

import { requestPlaybackUrl } from '../voice.api';
import { CHAT_I18N_KEYS } from '../chat.constants';
import type { ChatMessage } from '../chat.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  accent: '#00F5D4',
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  textOnAccent: '#0B0C10',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  waveform: 'rgba(255, 255, 255, 0.35)',
} as const;

const SPACING = { xs: 4, sm: 8, md: 12 } as const;
const FONT_SIZE = { body: 14, caption: 11 } as const;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const WAVEFORM_BARS = 24;

interface SoundLike {
  playAsync: () => Promise<unknown>;
  pauseAsync: () => Promise<unknown>;
  unloadAsync: () => Promise<unknown>;
  setOnPlaybackStatusUpdate: (cb: (status: { didJustFinish?: boolean }) => void) => void;
}

export interface VoiceNotePlayerProps {
  message: ChatMessage;
  isOwn: boolean;
}

export function VoiceNotePlayer({ message, isOwn }: VoiceNotePlayerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const soundRef = useRef<SoundLike | null>(null);

  const voice = message.voiceNote;

  const unload = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound !== null) {
      await sound.unloadAsync().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    return () => {
      void unload();
    };
  }, [unload]);

  const resolveSource = useCallback(async (): Promise<string | null> => {
    if (message.localAudioUri !== undefined) {
      return message.localAudioUri;
    }
    try {
      const target = await requestPlaybackUrl(message.conversationId, message.id);
      return target.playbackUrl;
    } catch {
      return null;
    }
  }, [message.conversationId, message.id, message.localAudioUri]);

  const togglePlay = useCallback(async () => {
    if (isPlaying && soundRef.current !== null) {
      await soundRef.current.pauseAsync().catch(() => undefined);
      setIsPlaying(false);
      return;
    }
    if (soundRef.current !== null) {
      await soundRef.current.playAsync().catch(() => undefined);
      setIsPlaying(true);
      return;
    }
    setIsLoading(true);
    const source = await resolveSource();
    if (source === null) {
      setIsLoading(false);
      return;
    }
    try {
      const { sound } = await Audio.Sound.createAsync({ uri: source }, { shouldPlay: true });
      const typed = sound as unknown as SoundLike;
      typed.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish === true) {
          setIsPlaying(false);
        }
      });
      soundRef.current = typed;
      setIsPlaying(true);
    } catch {
      // Playback failure is non-fatal; leave the control ready to retry.
    } finally {
      setIsLoading(false);
    }
  }, [isPlaying, resolveSource]);

  const transcriptNode = renderTranscript(voice, t);

  return (
    <View
      style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}
      testID={`voice-note-${message.id}`}
    >
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <View style={styles.playerRow}>
          <Pressable
            onPress={togglePlay}
            accessibilityRole="button"
            accessibilityLabel={t(isPlaying ? CHAT_I18N_KEYS.VOICE_PAUSE : CHAT_I18N_KEYS.VOICE_PLAY)}
            accessibilityState={{ busy: isLoading }}
            style={[styles.playButton, isOwn && styles.playButtonOwn]}
            testID={`voice-note-play-${message.id}`}
          >
            <Text style={[styles.playIcon, isOwn && styles.playIconOwn]}>
              {isPlaying ? '❚❚' : '▶'}
            </Text>
          </Pressable>
          <Waveform waveform={voice?.waveform ?? null} isOwn={isOwn} />
          <Text style={[styles.duration, isOwn && styles.durationOwn]} testID={`voice-note-duration-${message.id}`}>
            {formatDuration(voice?.durationMs ?? 0)}
          </Text>
        </View>
        {transcriptNode}
      </View>
    </View>
  );
}

/** Render the transcript by status; playback is never blocked by any state. */
function renderTranscript(
  voice: ChatMessage['voiceNote'],
  t: (key: string) => string,
): React.JSX.Element | null {
  if (voice === undefined) {
    return null;
  }
  if (voice.transcriptStatus === 'READY' && voice.transcript !== null) {
    return (
      <Text style={styles.transcript} testID="voice-note-transcript">
        {voice.transcript}
      </Text>
    );
  }
  if (voice.transcriptStatus === 'PENDING') {
    return (
      <Text style={styles.transcriptHint} testID="voice-note-transcript-pending">
        {t(CHAT_I18N_KEYS.VOICE_TRANSCRIPT_PENDING)}
      </Text>
    );
  }
  const fallbackKey =
    voice.transcriptStatus === 'FAILED'
      ? CHAT_I18N_KEYS.VOICE_TRANSCRIPT_FAILED
      : CHAT_I18N_KEYS.VOICE_TRANSCRIPT_DISABLED;
  return (
    <Text style={styles.transcriptHint} testID="voice-note-transcript-fallback">
      {t(fallbackKey)}
    </Text>
  );
}

/** A lightweight static waveform visual derived from the stored samples (bars only). */
function Waveform({
  waveform,
  isOwn,
}: {
  waveform: number[] | null;
  isOwn: boolean;
}): React.JSX.Element {
  const bars = normalizeWaveform(waveform);
  return (
    <View style={styles.waveform} testID="voice-note-waveform">
      {bars.map((height, index) => (
        <View
          key={index}
          style={[
            styles.waveformBar,
            { height: `${height}%` },
            isOwn ? styles.waveformBarOwn : styles.waveformBarOther,
          ]}
        />
      ))}
    </View>
  );
}

/** Normalize (or synthesize) a fixed number of bar heights in the 20–100% range. */
function normalizeWaveform(waveform: number[] | null): number[] {
  if (waveform === null || waveform.length === 0) {
    return Array.from({ length: WAVEFORM_BARS }, (_, i) => 30 + ((i * 7) % 60));
  }
  const max = Math.max(...waveform, 1);
  return waveform
    .slice(0, WAVEFORM_BARS)
    .map((sample) => 20 + Math.round((Math.abs(sample) / max) * 80));
}

/** Format milliseconds as m:ss. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: { marginVertical: SPACING.xs, paddingHorizontal: SPACING.md, maxWidth: '80%' },
  rowOwn: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 16, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, minWidth: 200 },
  bubbleOwn: { backgroundColor: COLORS.accent },
  bubbleOther: { backgroundColor: COLORS.card },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  playButtonOwn: { backgroundColor: 'rgba(11, 12, 16, 0.2)' },
  playIcon: { color: COLORS.textPrimary, fontSize: FONT_SIZE.body },
  playIconOwn: { color: COLORS.textOnAccent },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 28, gap: 2 },
  waveformBar: { flex: 1, borderRadius: 2 },
  waveformBarOwn: { backgroundColor: 'rgba(11, 12, 16, 0.35)' },
  waveformBarOther: { backgroundColor: COLORS.waveform },
  duration: { color: COLORS.textMuted, fontSize: FONT_SIZE.caption, minWidth: 34, textAlign: 'right' },
  durationOwn: { color: COLORS.textOnAccent },
  transcript: { color: COLORS.textPrimary, fontSize: FONT_SIZE.body, marginTop: SPACING.sm },
  transcriptHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.caption,
    fontStyle: 'italic',
    marginTop: SPACING.xs,
  },
});

export default VoiceNotePlayer;
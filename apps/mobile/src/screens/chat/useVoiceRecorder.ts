/**
 * useVoiceRecorder — expo-av recording for voice notes (Spec 14).
 *
 * Manages a single recording lifecycle: request mic permission (graceful i18n fallback when
 * denied — never crashes, never blocks text messaging), start with an elapsed-time ticker, stop
 * (auto-stops at the client-side max duration as a UX pre-check only), and expose the recorded
 * clip for preview/discard before the caller sends it. The backend/storage limits remain
 * authoritative. Never throws to the UI: errors surface as an i18n error key.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';

import {
  CHAT_I18N_KEYS,
  VOICE_MAX_DURATION_MS,
  VOICE_RECORDER_TICK_MS,
  VOICE_RECORDING_MIME_TYPE,
} from './chat.constants';
import type { RecordedClip } from './chat.types';

/** Recorder phase surfaced to the UI. */
export type RecorderPhase = 'idle' | 'recording' | 'recorded';

export interface UseVoiceRecorder {
  readonly phase: RecorderPhase;
  readonly elapsedMs: number;
  readonly clip: RecordedClip | null;
  readonly error: string | null;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly discard: () => void;
}

/** Minimal shape of an expo-av Recording instance the hook relies on (keeps typing local). */
interface RecordingLike {
  prepareToRecordAsync: (options: unknown) => Promise<void>;
  startAsync: () => Promise<void>;
  stopAndUnloadAsync: () => Promise<void>;
  getURI: () => string | null;
}

/** A recording-options preset that always exists (mock + native). */
const RECORDING_OPTIONS: unknown =
  (Audio as unknown as { RecordingOptionsPresets?: { HIGH_QUALITY?: unknown } })
    .RecordingOptionsPresets?.HIGH_QUALITY ?? {};

export function useVoiceRecorder(): UseVoiceRecorder {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<RecordingLike | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTicker = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const finalize = useCallback(async (): Promise<RecordedClip | null> => {
    const recording = recordingRef.current;
    if (recording === null) {
      return null;
    }
    recordingRef.current = null;
    clearTicker();
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // Stopping a non-started recorder is benign; fall through to URI resolution.
    }
    const uri = recording.getURI();
    if (uri === null) {
      return null;
    }
    const durationMs = Math.min(Date.now() - startedAtRef.current, VOICE_MAX_DURATION_MS);
    const sizeBytes = await resolveSize(uri);
    return { uri, durationMs, sizeBytes, mimeType: VOICE_RECORDING_MIME_TYPE };
  }, [clearTicker]);

  const stop = useCallback(async () => {
    const recorded = await finalize();
    if (recorded !== null) {
      setClip(recorded);
      setPhase('recorded');
    } else {
      setPhase('idle');
    }
  }, [finalize]);

  const start = useCallback(async () => {
    setError(null);
    setClip(null);
    let permission: { granted: boolean };
    try {
      permission = await Audio.requestPermissionsAsync();
    } catch {
      setError(CHAT_I18N_KEYS.VOICE_MIC_DENIED);
      return;
    }
    if (!permission.granted) {
      setError(CHAT_I18N_KEYS.VOICE_MIC_DENIED);
      return;
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording() as unknown as RecordingLike;
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase('recording');
      tickRef.current = setInterval(() => {
        const next = Date.now() - startedAtRef.current;
        setElapsedMs(next);
        if (next >= VOICE_MAX_DURATION_MS) {
          void stop();
        }
      }, VOICE_RECORDER_TICK_MS);
    } catch {
      recordingRef.current = null;
      clearTicker();
      setPhase('idle');
      setError(CHAT_I18N_KEYS.VOICE_SEND_ERROR);
    }
  }, [clearTicker, stop]);

  const discard = useCallback(() => {
    setClip(null);
    setElapsedMs(0);
    setPhase('idle');
    setError(null);
  }, []);

  // Clean up an in-flight recording + ticker on unmount.
  useEffect(() => {
    return () => {
      clearTicker();
      const recording = recordingRef.current;
      if (recording !== null) {
        void recording.stopAndUnloadAsync().catch(() => undefined);
        recordingRef.current = null;
      }
    };
  }, [clearTicker]);

  return { phase, elapsedMs, clip, error, start, stop, discard };
}

/** Best-effort size of the recorded file (blob length); 0 when unavailable (advisory only). */
async function resolveSize(uri: string): Promise<number> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.size;
  } catch {
    return 0;
  }
}
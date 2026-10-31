/**
 * useArrivalRecorder (Cleaner) — records a short arrival clip with expo-camera (Spec 18).
 *
 * Manages camera + microphone permission (requesting gracefully, exposing a status for an i18n
 * explanation on denial — never crashing, never hard-blocking the service), a recording elapsed
 * timer, and a CLIENT-SIDE max-duration pre-check (`VERIFICATION_MAX_DURATION_MS`). The pre-check is
 * UX only — the server re-inspects and is authoritative. The hook owns no upload logic (that is
 * `verification.api` via the store).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraView,
} from 'expo-camera';

import { VERIFICATION_MAX_DURATION_MS } from './verification.constants';
import type { RecordedClip } from './verification.types';

export type RecorderPermissionStatus = 'unknown' | 'granted' | 'denied';

/** Default video MIME assumed for a recorded clip (server re-inspects the real type). */
const DEFAULT_VIDEO_MIME = 'video/mp4';
/** One second in milliseconds (elapsed-timer tick). */
const TICK_MS = 1000;

export interface UseArrivalRecorderReturn {
  readonly permissionStatus: RecorderPermissionStatus;
  readonly isRecording: boolean;
  readonly elapsedMs: number;
  readonly maxDurationMs: number;
  /** Request (or re-request) camera + microphone permission. */
  readonly requestPermission: () => Promise<void>;
  /** Start recording; resolves with the clip when stopped or the max-duration cap is hit. */
  readonly startRecording: (camera: CameraView | null) => Promise<RecordedClip | null>;
  /** Stop an in-progress recording. */
  readonly stopRecording: (camera: CameraView | null) => void;
}

/** Manage camera/mic permission + a bounded arrival-clip recording. */
export function useArrivalRecorder(): UseArrivalRecorderReturn {
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimer(timerRef);
    };
  }, []);

  const permissionStatus = derivePermissionStatus(
    cameraPermission?.granted,
    micPermission?.granted,
    cameraPermission?.canAskAgain,
  );

  const requestPermission = useCallback(async () => {
    try {
      await requestCamera();
      await requestMic();
    } catch {
      // A permission request failure degrades gracefully — the caller shows the i18n explainer.
    }
  }, [requestCamera, requestMic]);

  const stopRecording = useCallback((camera: CameraView | null) => {
    clearTimer(timerRef);
    if (isMountedRef.current) {
      setIsRecording(false);
    }
    camera?.stopRecording();
  }, []);

  const startRecording = useCallback(
    async (camera: CameraView | null): Promise<RecordedClip | null> => {
      if (!camera || permissionStatus !== 'granted') {
        return null;
      }
      setIsRecording(true);
      setElapsedMs(0);
      startTimer(timerRef, isMountedRef, setElapsedMs, () => stopRecording(camera));
      try {
        const video = await camera.recordAsync({
          maxDuration: Math.floor(VERIFICATION_MAX_DURATION_MS / TICK_MS),
        });
        return video ? buildClip(video.uri) : null;
      } catch {
        return null;
      } finally {
        clearTimer(timerRef);
        if (isMountedRef.current) {
          setIsRecording(false);
        }
      }
    },
    [permissionStatus, stopRecording],
  );

  return {
    permissionStatus,
    isRecording,
    elapsedMs,
    maxDurationMs: VERIFICATION_MAX_DURATION_MS,
    requestPermission,
    startRecording,
    stopRecording,
  };
}

/** Derive the combined camera+mic permission status for the UI. */
function derivePermissionStatus(
  cameraGranted: boolean | undefined,
  micGranted: boolean | undefined,
  canAskAgain: boolean | undefined,
): RecorderPermissionStatus {
  if (cameraGranted && micGranted) {
    return 'granted';
  }
  if (canAskAgain === false) {
    return 'denied';
  }
  if (cameraGranted === false || micGranted === false) {
    return 'denied';
  }
  return 'unknown';
}

/** Build a RecordedClip from a recorded file URI (size/type advisory; server re-inspects). */
function buildClip(uri: string): RecordedClip {
  return { uri, durationMs: 0, mimeType: DEFAULT_VIDEO_MIME, sizeBytes: 0 };
}

/** Start the elapsed-timer, auto-stopping when the client-side max duration is reached. */
function startTimer(
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  isMountedRef: React.MutableRefObject<boolean>,
  setElapsedMs: (updater: (prev: number) => number) => void,
  onCap: () => void,
): void {
  clearTimer(timerRef);
  timerRef.current = setInterval(() => {
    if (!isMountedRef.current) {
      return;
    }
    setElapsedMs((prev) => {
      const next = prev + TICK_MS;
      if (next >= VERIFICATION_MAX_DURATION_MS) {
        onCap();
      }
      return next;
    });
  }, TICK_MS);
}

/** Clear the elapsed-timer interval. */
function clearTimer(
  timerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
): void {
  if (timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

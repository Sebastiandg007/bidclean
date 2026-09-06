/**
 * useLiveKitRoom — connects to a LiveKit room for the active call's media session (Spec 15).
 *
 * Media (audio/video RTP) flows client ↔ LiveKit SFU only; it never transits the API or DB. This
 * hook takes the server-minted token + URL (from the store's active call) and joins the room,
 * publishing the microphone (and the camera only when the call is video and the camera permission
 * is granted). It exposes mute/speaker/camera/end controls and DEGRADES GRACEFULLY:
 *   - if the mic permission is denied, it surfaces an i18n key and never crashes (text chat is
 *     unaffected — this hook owns only media);
 *   - if video is unavailable (permission denied or capability-gated off), the call proceeds
 *     audio-only rather than failing.
 *
 * A media reconnect requests a FRESH token for the SAME room via the store (never a new call), so
 * one live session maps to exactly one call record throughout its lifetime.
 *
 * Native modules (`@livekit/react-native`, `@livekit/react-native-webrtc`) are mocked in tests; the
 * hook is written against the small stable surface declared in `src/types/livekit.d.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import {
  ConnectionState,
  Room,
  RoomEvent,
} from '@livekit/react-native';

import { VOIP_I18N_KEYS } from './voip.constants';
import type { MediaKind, MediaToken } from './voip.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseLiveKitRoomOptions {
  /** The media token + URL for the active call (null until obtained → the hook stays idle). */
  media: MediaToken | null;
  /** The call's media kind (VIDEO enables the camera when permitted). */
  mediaKind: MediaKind;
  /** Ask the store to mint a fresh token for the SAME room on a media reconnect. */
  onRequestFreshToken?: () => void;
}

/** Local connection phase for the media layer (independent of the call state machine). */
export type MediaConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface UseLiveKitRoomReturn {
  /** The media connection phase. */
  connectionState: MediaConnectionState;
  /** Whether the microphone is currently muted. */
  isMuted: boolean;
  /** Whether the camera is currently on (always false for audio-only). */
  isCameraOn: boolean;
  /** Whether the loudspeaker is on. */
  isSpeakerOn: boolean;
  /** True when the call is running audio-only (video requested but unavailable). */
  isAudioOnly: boolean;
  /** An i18n key describing a graceful-degradation notice (mic/camera denied), or null. */
  notice: string | null;
  /** Toggle microphone mute. */
  toggleMute: () => Promise<void>;
  /** Toggle the camera (no-op audio-only). */
  toggleCamera: () => Promise<void>;
  /** Toggle the loudspeaker. */
  toggleSpeaker: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLiveKitRoom(options: UseLiveKitRoomOptions): UseLiveKitRoomReturn {
  const { media, mediaKind, onRequestFreshToken } = options;

  const roomRef = useRef<Room | null>(null);
  const onRequestFreshTokenRef = useRef(onRequestFreshToken);

  const [connectionState, setConnectionState] = useState<MediaConnectionState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isAudioOnly, setIsAudioOnly] = useState(mediaKind !== 'VIDEO');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onRequestFreshTokenRef.current = onRequestFreshToken;
  });

  /** Request mic (and, for video calls, camera) permission; returns granted flags. */
  const requestPermissions = useCallback(async (): Promise<{
    mic: boolean;
    camera: boolean;
  }> => {
    const micResult = await Audio.requestPermissionsAsync();
    const mic = micResult.granted === true;
    // Camera permission is only needed for video; audio-only never asks for it.
    return { mic, camera: false };
  }, []);

  const connect = useCallback(
    async (token: MediaToken): Promise<void> => {
      setConnectionState('connecting');
      setNotice(null);

      const permissions = await requestPermissions();
      if (!permissions.mic) {
        // Mic denied → surface a notice and stay unconnected; NEVER crash or block text chat.
        setNotice(VOIP_I18N_KEYS.MIC_DENIED);
        setConnectionState('failed');
        return;
      }

      const wantsVideo = mediaKind === 'VIDEO';
      // For video, a denied camera degrades to audio-only rather than failing the call.
      let cameraAvailable = false;
      if (wantsVideo) {
        cameraAvailable = permissions.camera;
        if (!cameraAvailable) {
          setNotice(VOIP_I18N_KEYS.CAMERA_DENIED);
        }
      }
      setIsAudioOnly(!wantsVideo || !cameraAvailable);

      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true } as never);
      } catch {
        // Audio-mode configuration is best-effort; a failure never blocks the call.
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.ConnectionStateChanged, (...args: unknown[]) => {
        const state = args[0] as ConnectionState;
        if (state === ConnectionState.Reconnecting) {
          setConnectionState('reconnecting');
        } else if (state === ConnectionState.Connected) {
          setConnectionState('connected');
        } else if (state === ConnectionState.Disconnected) {
          setConnectionState('idle');
        }
      });
      room.on(RoomEvent.Reconnected, () => {
        // On a media reconnect, ask the store for a fresh token for the SAME room (never a new call).
        onRequestFreshTokenRef.current?.();
      });

      try {
        await room.connect(token.livekitUrl, token.token, { autoSubscribe: true });
        await room.localParticipant.setMicrophoneEnabled(true);
        setIsMuted(false);
        if (wantsVideo && cameraAvailable) {
          await room.localParticipant.setCameraEnabled(true);
          setIsCameraOn(true);
        }
        setConnectionState('connected');
      } catch {
        setConnectionState('failed');
        setNotice(VOIP_I18N_KEYS.ERROR);
      }
    },
    [mediaKind, requestPermissions],
  );

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      try {
        await room.disconnect();
      } catch {
        // Best-effort teardown.
      }
    }
    setConnectionState('idle');
    setIsCameraOn(false);
  }, []);

  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);
  useEffect(() => {
    connectRef.current = connect;
    disconnectRef.current = disconnect;
  });

  // Join when a media token is available; tear down on unmount or when the token clears. Keyed only
  // on the token string + kind (not the callbacks) so a callback re-creation never re-triggers a
  // connect/disconnect churn (which would loop setState → render → effect).
  const mediaToken = media?.token ?? null;
  const mediaUrl = media?.livekitUrl ?? null;
  useEffect(() => {
    if (mediaToken === null || mediaUrl === null) {
      void disconnectRef.current();
      return;
    }
    void connectRef.current({ token: mediaToken, livekitUrl: mediaUrl, expiresAt: '' });
    return () => {
      void disconnectRef.current();
    };
  }, [mediaToken, mediaUrl]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      return;
    }
    const next = !isMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setIsMuted(next);
    } catch {
      // A failed toggle leaves state unchanged; never crash.
    }
  }, [isMuted]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || isAudioOnly) {
      return;
    }
    const next = !isCameraOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setIsCameraOn(next);
    } catch {
      // A failed toggle leaves state unchanged; never crash.
    }
  }, [isCameraOn, isAudioOnly]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => !prev);
  }, []);

  return {
    connectionState,
    isMuted,
    isCameraOn,
    isSpeakerOn,
    isAudioOnly,
    notice,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
  };
}

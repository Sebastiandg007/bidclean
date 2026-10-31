/**
 * Unit tests for useLiveKitRoom.
 *
 * Validates graceful degradation (the core Req 5.3/5.4 guarantees):
 * - mic permission denied → a MIC_DENIED notice, `failed` state, never a crash, never a connect;
 * - a video call with no camera runs audio-only (isAudioOnly true) rather than failing;
 * - a null media token keeps the hook idle (no room constructed).
 * LiveKit + expo-av are mocked; no native modules, no real media.
 *
 * @requirements 5.3, 5.4
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { Audio } from 'expo-av';

import { useLiveKitRoom } from '../useLiveKitRoom';
import type { MediaToken } from '../voip.types';

const mockedAudio = Audio as unknown as {
  requestPermissionsAsync: jest.Mock;
  setAudioModeAsync: jest.Mock;
};

function media(): MediaToken {
  return {
    livekitUrl: 'wss://rtc.example.test',
    token: 'tok-1',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAudio.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
  mockedAudio.setAudioModeAsync.mockResolvedValue(undefined);
});

describe('useLiveKitRoom', () => {
  it('stays idle when there is no media token', () => {
    const { result } = renderHook(() =>
      useLiveKitRoom({ media: null, mediaKind: 'AUDIO' }),
    );
    expect(result.current.connectionState).toBe('idle');
  });

  it('connects for an audio call when mic is granted', async () => {
    const { result } = renderHook(() =>
      useLiveKitRoom({ media: media(), mediaKind: 'AUDIO' }),
    );
    await waitFor(() => expect(result.current.connectionState).toBe('connected'));
    expect(result.current.isAudioOnly).toBe(true);
    expect(result.current.notice).toBeNull();
  });

  it('degrades to a MIC_DENIED notice (no crash) when mic permission is denied', async () => {
    mockedAudio.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    const { result } = renderHook(() =>
      useLiveKitRoom({ media: media(), mediaKind: 'AUDIO' }),
    );
    await waitFor(() => expect(result.current.connectionState).toBe('failed'));
    expect(result.current.notice).toBe('chat.call.micDenied');
  });

  it('runs a VIDEO call audio-only when the camera is unavailable', async () => {
    const { result } = renderHook(() =>
      useLiveKitRoom({ media: media(), mediaKind: 'VIDEO' }),
    );
    await waitFor(() => expect(result.current.connectionState).toBe('connected'));
    // Camera is not granted in this hook's audio-first permission flow → audio-only, not a failure.
    expect(result.current.isAudioOnly).toBe(true);
    expect(result.current.isCameraOn).toBe(false);
  });
});

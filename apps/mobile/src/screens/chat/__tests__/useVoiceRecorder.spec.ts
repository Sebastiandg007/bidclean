/**
 * Unit tests for useVoiceRecorder (task 12.4).
 *
 * Covers: permission-denied graceful fallback (i18n error, never throws); a successful
 * record -> stop produces a clip in the `recorded` phase; discard returns to idle. `expo-av` is
 * mocked in the global setup; per-test overrides toggle the permission result.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Audio } from 'expo-av';

import { useVoiceRecorder } from '../useVoiceRecorder';
import { CHAT_I18N_KEYS } from '../chat.constants';

const mockedRequestPermissions = Audio.requestPermissionsAsync as jest.MockedFunction<
  typeof Audio.requestPermissionsAsync
>;

describe('useVoiceRecorder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' } as never);
  });

  it('degrades gracefully with an i18n error when mic permission is denied', async () => {
    mockedRequestPermissions.mockResolvedValue({ granted: false, status: 'denied' } as never);
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBe(CHAT_I18N_KEYS.VOICE_MIC_DENIED);
  });

  it('records then stops, producing a clip in the recorded phase', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe('recording');

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.phase).toBe('recorded');
    expect(result.current.clip).not.toBeNull();
    expect(result.current.clip?.uri).toBe('file:///tmp/voice-note.m4a');
    expect(result.current.clip?.mimeType).toBe('audio/mp4');
  });

  it('discard returns to idle and clears the clip', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    act(() => {
      result.current.discard();
    });
    expect(result.current.phase).toBe('idle');
    expect(result.current.clip).toBeNull();
  });
});
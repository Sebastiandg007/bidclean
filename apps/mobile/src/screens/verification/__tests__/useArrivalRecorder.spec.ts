/**
 * Unit tests for useArrivalRecorder (Spec 18).
 *
 * Covers the combined camera+mic permission status (granted / denied graceful degrade) and the
 * client-side max-duration pre-check surfaced to the UI. expo-camera is mocked (no native module).
 */

const mockRequestCamera = jest.fn().mockResolvedValue({ granted: true });
const mockRequestMic = jest.fn().mockResolvedValue({ granted: true });
let mockCameraPermission: { granted: boolean; canAskAgain: boolean } | null = {
  granted: true,
  canAskAgain: true,
};
let mockMicPermission: { granted: boolean; canAskAgain: boolean } | null = {
  granted: true,
  canAskAgain: true,
};

jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockCameraPermission, mockRequestCamera],
  useMicrophonePermissions: () => [mockMicPermission, mockRequestMic],
  CameraView: () => null,
}));

import { renderHook, act } from '@testing-library/react-native';

import { useArrivalRecorder } from '../useArrivalRecorder';
import { VERIFICATION_MAX_DURATION_MS } from '../verification.constants';

beforeEach(() => {
  jest.clearAllMocks();
  mockCameraPermission = { granted: true, canAskAgain: true };
  mockMicPermission = { granted: true, canAskAgain: true };
});

describe('useArrivalRecorder — permission status', () => {
  it('reports granted when both camera and mic are granted', () => {
    const { result } = renderHook(() => useArrivalRecorder());
    expect(result.current.permissionStatus).toBe('granted');
  });

  it('reports denied when camera is refused (graceful degrade, no crash)', () => {
    mockCameraPermission = { granted: false, canAskAgain: false };
    const { result } = renderHook(() => useArrivalRecorder());
    expect(result.current.permissionStatus).toBe('denied');
  });

  it('reports denied when the mic is refused', () => {
    mockMicPermission = { granted: false, canAskAgain: true };
    const { result } = renderHook(() => useArrivalRecorder());
    expect(result.current.permissionStatus).toBe('denied');
  });

  it('requestPermission never throws even if the underlying request rejects', async () => {
    mockRequestCamera.mockRejectedValueOnce(new Error('denied by user'));
    const { result } = renderHook(() => useArrivalRecorder());
    await act(async () => {
      await result.current.requestPermission();
    });
    expect(mockRequestCamera).toHaveBeenCalled();
  });
});

describe('useArrivalRecorder — client-side max-duration pre-check', () => {
  it('exposes the configured max duration (UX pre-check)', () => {
    const { result } = renderHook(() => useArrivalRecorder());
    expect(result.current.maxDurationMs).toBe(VERIFICATION_MAX_DURATION_MS);
  });

  it('startRecording returns null when permission is not granted (never blocks)', async () => {
    mockCameraPermission = { granted: false, canAskAgain: false };
    const { result } = renderHook(() => useArrivalRecorder());
    let clip: unknown;
    await act(async () => {
      clip = await result.current.startRecording(null);
    });
    expect(clip).toBeNull();
  });
});

/**
 * Unit tests for usePhotoCapture (Spec 19 · P15): the client-side max-size pre-check and graceful
 * camera-permission-denied degrade (never crashes, returns a reason key). `expo-image-picker` is
 * mocked (zero real device access).
 */

import { renderHook, act } from '@testing-library/react-native';

import { usePhotoCapture } from '../usePhotoCapture';
import { CHECKLIST_I18N_KEYS } from '../checklist.constants';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

import {
  launchCameraAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';

const mockPermission = requestCameraPermissionsAsync as jest.Mock;
const mockLaunch = launchCameraAsync as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('usePhotoCapture', () => {
  it('returns a reason key when camera permission is denied (never throws)', async () => {
    mockPermission.mockResolvedValue({ granted: false, status: 'denied' });
    const { result } = renderHook(() => usePhotoCapture());
    let outcome;
    await act(async () => {
      outcome = await result.current.capture();
    });
    expect(outcome).toEqual({ status: 'error', reasonKey: CHECKLIST_I18N_KEYS.PERMISSION_DENIED });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('rejects an over-size photo with the too-large key (client pre-check)', async () => {
    mockPermission.mockResolvedValue({ granted: true, status: 'granted' });
    mockLaunch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://big', width: 4000, height: 3000, fileSize: 999_999_999, mimeType: 'image/jpeg' }],
    });
    const { result } = renderHook(() => usePhotoCapture());
    let outcome;
    await act(async () => {
      outcome = await result.current.capture();
    });
    expect(outcome).toEqual({ status: 'error', reasonKey: CHECKLIST_I18N_KEYS.PHOTO_TOO_LARGE });
  });

  it('returns a captured asset for an acceptable photo', async () => {
    mockPermission.mockResolvedValue({ granted: true, status: 'granted' });
    mockLaunch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://ok', width: 100, height: 100, fileSize: 2048, mimeType: 'image/png' }],
    });
    const { result } = renderHook(() => usePhotoCapture());
    let outcome;
    await act(async () => {
      outcome = await result.current.capture();
    });
    expect(outcome).toEqual({
      status: 'captured',
      photo: { uri: 'file://ok', sizeBytes: 2048, mimeType: 'image/png', width: 100, height: 100 },
    });
  });

  it('returns cancelled when the picker is dismissed', async () => {
    mockPermission.mockResolvedValue({ granted: true, status: 'granted' });
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });
    const { result } = renderHook(() => usePhotoCapture());
    let outcome;
    await act(async () => {
      outcome = await result.current.capture();
    });
    expect(outcome).toEqual({ status: 'cancelled' });
  });
});

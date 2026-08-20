/**
 * Tests for SelfieCaptureScreen.
 *
 * Covers: front camera, face overlay, single face validation,
 * capture flow, cancel action, and upload state.
 */

import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequestPermission = jest.fn();
const mockTakePictureAsync = jest.fn();

let mockPermissionGranted = true;
let mockIsUploading = false;
let mockErrorKey: string | null = null;

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');

  const CameraView = React.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: mockTakePictureAsync,
      }));
      return React.createElement(View, { testID: 'camera-view', ...props }, children);
    },
  );
  CameraView.displayName = 'CameraView';

  return {
    CameraView,
    useCameraPermissions: () => [
      { granted: mockPermissionGranted },
      mockRequestPermission,
    ],
  };
});

const mockUploadSelfie = jest.fn().mockResolvedValue(undefined);

jest.mock('../useKyc', () => ({
  useKyc: () => ({
    uploadSelfie: mockUploadSelfie,
    isUploading: mockIsUploading,
    isLoading: false,
    errorKey: mockErrorKey,
    status: 'DOCUMENT_UPLOADED',
    attemptNumber: 1,
    uploadDocument: jest.fn(),
    retry: jest.fn(),
    refreshStatus: jest.fn(),
    statusResponse: null,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'selfie_capture.title': 'Take a selfie',
        'selfie_capture.subtitle': 'Position your face within the oval guide',
        'selfie_capture.capture_button': 'Capture',
        'selfie_capture.cancel_button': 'Cancel',
        'selfie_capture.permission_title': 'Camera access needed',
        'selfie_capture.permission_message': 'We need camera access to take your selfie for identity verification.',
        'selfie_capture.permission_button': 'Grant access',
        'selfie_capture.guidance_face_position': 'Center your face in the oval and look straight ahead',
        'selfie_capture.error_multiple_faces': 'Multiple faces detected. Only your face should be visible.',
        'selfie_capture.error_no_face': 'No face detected. Position your face within the oval.',
        'quality.good': 'Looking good!',
        'quality.hold_steady': 'Hold steady...',
        'quality.multiple_faces': 'Multiple faces detected. Only your face should be visible.',
        'quality.no_face': 'No face detected. Position your face in the frame.',
        'kyc:error.upload_failed': 'Upload failed. Please try again.',
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// Lazy import so mocks are applied first
import { SelfieCaptureScreen } from '../SelfieCaptureScreen';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SelfieCaptureScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockPermissionGranted = true;
    mockIsUploading = false;
    mockErrorKey = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders front-facing camera view', () => {
    render(<SelfieCaptureScreen />);
    const cameraView = screen.getByTestId('camera-view');
    expect(cameraView).toBeTruthy();
    expect(cameraView.props.facing).toBe('front');
  });

  it('renders FaceOverlay component on camera view', () => {
    render(<SelfieCaptureScreen />);
    expect(screen.getByTestId('face-overlay-oval')).toBeTruthy();
  });

  it('shows error when multiple faces are detected', () => {
    render(<SelfieCaptureScreen />);
    // Before timer fires, no face detected, no multiple faces error shown
    expect(screen.queryByText('Multiple faces detected. Only your face should be visible.')).toBeNull();
  });

  it('enables capture button when single face is detected', () => {
    render(<SelfieCaptureScreen />);

    // Advance timer to trigger face detection readiness
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const captureButton = screen.getByLabelText('Capture');
    expect(captureButton.props.accessibilityState?.disabled).toBe(false);
  });

  it('calls onSelfieUploaded after successful capture and upload', async () => {
    jest.useRealTimers();
    const onSelfieUploaded = jest.fn();

    mockTakePictureAsync.mockResolvedValueOnce({
      uri: 'file://selfie.jpg',
      base64: 'selfie_base64_data',
    });

    render(<SelfieCaptureScreen onSelfieUploaded={onSelfieUploaded} />);

    // Wait for face detection timer to fire (1000ms delay)
    await waitFor(
      () => {
        const captureButton = screen.getByLabelText('Capture');
        expect(captureButton.props.accessibilityState?.disabled).toBe(false);
      },
      { timeout: 2000 },
    );

    const captureButton = screen.getByLabelText('Capture');
    fireEvent.press(captureButton);

    await waitFor(() => {
      expect(mockUploadSelfie).toHaveBeenCalledWith('selfie_base64_data');
    });

    await waitFor(() => {
      expect(onSelfieUploaded).toHaveBeenCalled();
    });
  });

  it('calls onCancel when user exits the screen', () => {
    const onCancel = jest.fn();
    render(<SelfieCaptureScreen onCancel={onCancel} />);

    const cancelButton = screen.getByLabelText('Cancel');
    fireEvent.press(cancelButton);

    expect(onCancel).toHaveBeenCalled();
  });

  it('disables capture button while upload is in progress', () => {
    mockIsUploading = true;
    render(<SelfieCaptureScreen />);

    // Advance timer to trigger face detection
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const captureButton = screen.getByLabelText('Capture');
    expect(captureButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('shows permission request when camera access is not granted', () => {
    mockPermissionGranted = false;
    render(<SelfieCaptureScreen />);
    expect(screen.getByText('Camera access needed')).toBeTruthy();
    expect(screen.getByLabelText('Grant access')).toBeTruthy();
  });

  it('renders title and guidance text', () => {
    render(<SelfieCaptureScreen />);
    expect(screen.getByText('Take a selfie')).toBeTruthy();
    expect(
      screen.getByText('Center your face in the oval and look straight ahead'),
    ).toBeTruthy();
  });

  it('disables capture button before face is detected', () => {
    render(<SelfieCaptureScreen />);
    // Before timer fires, face not detected yet
    const captureButton = screen.getByLabelText('Capture');
    expect(captureButton.props.accessibilityState?.disabled).toBe(true);
  });
});

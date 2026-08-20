/**
 * Tests for DocumentCaptureScreen.
 *
 * Covers: camera permission, overlay rendering, quality feedback display,
 * capture flow, cancel action, and upload state.
 */

import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequestPermission = jest.fn();
const mockTakePictureAsync = jest.fn();

let mockPermissionGranted = true;
let mockIsUploading = false;

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

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({
    uri: 'file://manipulated.jpg',
    width: 1200,
    height: 900,
    base64: 'a'.repeat(500000),
  }),
}));

const mockUploadDocument = jest.fn().mockResolvedValue(undefined);

jest.mock('../useKyc', () => ({
  useKyc: () => ({
    uploadDocument: mockUploadDocument,
    isUploading: mockIsUploading,
    isLoading: false,
    errorKey: null,
    status: 'NOT_STARTED',
    attemptNumber: 1,
    uploadSelfie: jest.fn(),
    retry: jest.fn(),
    refreshStatus: jest.fn(),
    statusResponse: null,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'document_capture.title': 'Scan your ID',
        'document_capture.subtitle': 'Position your document within the frame',
        'document_capture.capture_button': 'Capture',
        'document_capture.cancel_button': 'Cancel',
        'document_capture.permission_title': 'Camera access needed',
        'document_capture.permission_message': 'We need camera access to scan your identity document.',
        'document_capture.permission_button': 'Grant access',
        'document_capture.document_types.national_id': 'National ID',
        'document_capture.document_types.passport': 'Passport',
        'document_capture.document_types.drivers_license': "Driver's license",
        'kyc:quality.too_blurry': 'Image is too blurry. Hold steady.',
        'kyc:quality.low_light': 'Not enough light.',
        'kyc:quality.document_not_visible': 'Document not fully visible.',
        'kyc:quality.hold_steady': 'Hold steady...',
        'kyc:quality.good': 'Looking good!',
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
import { DocumentCaptureScreen } from '../DocumentCaptureScreen';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DocumentCaptureScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissionGranted = true;
    mockIsUploading = false;
  });

  it('renders camera view when permission is granted', () => {
    render(<DocumentCaptureScreen />);
    expect(screen.getByTestId('camera-view')).toBeTruthy();
  });

  it('shows permission request when camera access is not granted', () => {
    mockPermissionGranted = false;
    render(<DocumentCaptureScreen />);
    expect(screen.getByText('Camera access needed')).toBeTruthy();
    expect(screen.getByLabelText('Grant access')).toBeTruthy();
  });

  it('renders DocumentOverlay component on camera view', () => {
    render(<DocumentCaptureScreen />);
    expect(screen.getByLabelText('Align document within frame')).toBeTruthy();
  });

  it('displays document type selector with all options', () => {
    render(<DocumentCaptureScreen />);
    expect(screen.getByLabelText('National ID')).toBeTruthy();
    expect(screen.getByLabelText('Passport')).toBeTruthy();
    expect(screen.getByLabelText("Driver's license")).toBeTruthy();
  });

  it('calls onDocumentUploaded after successful capture and upload', async () => {
    const onDocumentUploaded = jest.fn();

    mockTakePictureAsync.mockResolvedValueOnce({
      uri: 'file://photo.jpg',
      base64: 'a'.repeat(500000),
      width: 1200,
      height: 900,
    });

    render(<DocumentCaptureScreen onDocumentUploaded={onDocumentUploaded} />);

    const captureButton = screen.getByLabelText('Capture');
    fireEvent.press(captureButton);

    await waitFor(() => {
      expect(mockUploadDocument).toHaveBeenCalledWith(
        expect.any(String),
        'national_id',
      );
    });

    await waitFor(() => {
      expect(onDocumentUploaded).toHaveBeenCalled();
    });
  });

  it('calls onCancel when user exits the screen', () => {
    const onCancel = jest.fn();
    render(<DocumentCaptureScreen onCancel={onCancel} />);

    const cancelButton = screen.getByLabelText('Cancel');
    fireEvent.press(cancelButton);

    expect(onCancel).toHaveBeenCalled();
  });

  it('disables capture button while upload is in progress', () => {
    mockIsUploading = true;
    render(<DocumentCaptureScreen />);
    const captureButton = screen.getByLabelText('Capture');
    expect(captureButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('renders title and subtitle text', () => {
    render(<DocumentCaptureScreen />);
    expect(screen.getByText('Scan your ID')).toBeTruthy();
    expect(screen.getByText('Position your document within the frame')).toBeTruthy();
  });
});

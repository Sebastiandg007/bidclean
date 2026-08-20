/**
 * Tests for KycStatusScreen.
 *
 * Covers: status display per state, retry button visibility,
 * verified callback, polling, and banner/CTA for incomplete states.
 */

import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

let mockStatus = 'NOT_STARTED';
let mockAttemptNumber = 1;
let mockRejectionReason: string | null = null;
const mockRefreshStatus = jest.fn().mockResolvedValue(undefined);
const mockRetry = jest.fn().mockResolvedValue(undefined);

jest.mock('../useKyc', () => ({
  useKyc: () => ({
    status: mockStatus,
    isLoading: false,
    isUploading: false,
    errorKey: null,
    attemptNumber: mockAttemptNumber,
    uploadDocument: jest.fn(),
    uploadSelfie: jest.fn(),
    retry: mockRetry,
    refreshStatus: mockRefreshStatus,
    statusResponse: mockRejectionReason
      ? { status: mockStatus, attemptNumber: mockAttemptNumber, rejectionReason: mockRejectionReason, documentUploadedAt: null, selfieUploadedAt: null, processingStartedAt: null, completedAt: null }
      : { status: mockStatus, attemptNumber: mockAttemptNumber, rejectionReason: null, documentUploadedAt: null, selfieUploadedAt: null, processingStartedAt: null, completedAt: null },
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'status.title': 'Identity Verification',
        'status.processing': 'Verifying your identity...',
        'status.processing_subtitle': 'This usually takes a few minutes',
        'status.verified': 'Identity verified',
        'status.verified_subtitle': 'You can now accept cleaning offers',
        'status.rejected': 'Verification failed',
        'status.incomplete_title': 'Complete your verification',
        'status.incomplete_subtitle': 'Upload your documents to start accepting offers',
        'status.start_verification': 'Start verification',
        'status.retry_button': 'Try again',
      };
      if (key === 'status.rejected_subtitle' && options?.reason) {
        return `Reason: ${options.reason}`;
      }
      if (key === 'status.attempt_label' && options?.number) {
        return `Attempt ${options.number}`;
      }
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
import { KycStatusScreen } from '../KycStatusScreen';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('KycStatusScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockStatus = 'NOT_STARTED';
    mockAttemptNumber = 1;
    mockRejectionReason = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('displays processing state with activity indicator', () => {
    mockStatus = 'PROCESSING';
    render(<KycStatusScreen />);

    expect(screen.getByTestId('processing-indicator')).toBeTruthy();
    expect(screen.getByText('Verifying your identity...')).toBeTruthy();
    expect(screen.getByText('This usually takes a few minutes')).toBeTruthy();
  });

  it('displays verified state with success message', () => {
    mockStatus = 'VERIFIED';
    render(<KycStatusScreen />);

    expect(screen.getByText('Identity verified')).toBeTruthy();
    expect(screen.getByText('You can now accept cleaning offers')).toBeTruthy();
  });

  it('displays rejected state with rejection reason', () => {
    mockStatus = 'REJECTED';
    mockRejectionReason = 'Document expired';
    render(<KycStatusScreen />);

    expect(screen.getByText('Verification failed')).toBeTruthy();
    expect(screen.getByText('Reason: Document expired')).toBeTruthy();
  });

  it('shows retry button only when status is REJECTED', () => {
    mockStatus = 'REJECTED';
    render(<KycStatusScreen />);

    expect(screen.getByTestId('retry-button')).toBeTruthy();
  });

  it('hides retry button when status is PROCESSING', () => {
    mockStatus = 'PROCESSING';
    render(<KycStatusScreen />);

    expect(screen.queryByTestId('retry-button')).toBeNull();
  });

  it('hides retry button when status is VERIFIED', () => {
    mockStatus = 'VERIFIED';
    render(<KycStatusScreen />);

    expect(screen.queryByTestId('retry-button')).toBeNull();
  });

  it('calls onRetry when retry button is pressed', async () => {
    mockStatus = 'REJECTED';
    const onRetry = jest.fn();
    render(<KycStatusScreen onRetry={onRetry} />);

    const retryButton = screen.getByTestId('retry-button');
    await act(async () => {
      fireEvent.press(retryButton);
    });

    await waitFor(() => {
      expect(mockRetry).toHaveBeenCalled();
      expect(onRetry).toHaveBeenCalled();
    });
  });

  it('calls onVerified when status is VERIFIED', () => {
    mockStatus = 'VERIFIED';
    const onVerified = jest.fn();
    render(<KycStatusScreen onVerified={onVerified} />);

    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('shows banner/CTA for NOT_STARTED state', () => {
    mockStatus = 'NOT_STARTED';
    render(<KycStatusScreen />);

    expect(screen.getByText('Complete your verification')).toBeTruthy();
    expect(screen.getByText('Upload your documents to start accepting offers')).toBeTruthy();
    expect(screen.getByTestId('start-verification-button')).toBeTruthy();
  });

  it('shows banner/CTA for DOCUMENT_UPLOADED state', () => {
    mockStatus = 'DOCUMENT_UPLOADED';
    render(<KycStatusScreen />);

    expect(screen.getByText('Complete your verification')).toBeTruthy();
    expect(screen.getByTestId('start-verification-button')).toBeTruthy();
  });

  it('shows banner/CTA for SELFIE_UPLOADED state', () => {
    mockStatus = 'SELFIE_UPLOADED';
    render(<KycStatusScreen />);

    expect(screen.getByText('Complete your verification')).toBeTruthy();
    expect(screen.getByTestId('start-verification-button')).toBeTruthy();
  });

  it('polls server for status updates while PROCESSING', () => {
    mockStatus = 'PROCESSING';
    render(<KycStatusScreen />);

    expect(mockRefreshStatus).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockRefreshStatus).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockRefreshStatus).toHaveBeenCalledTimes(2);
  });

  it('does not poll when status is not PROCESSING', () => {
    mockStatus = 'VERIFIED';
    render(<KycStatusScreen />);

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(mockRefreshStatus).not.toHaveBeenCalled();
  });

  it('displays attempt number when greater than 1', () => {
    mockStatus = 'REJECTED';
    mockAttemptNumber = 3;
    render(<KycStatusScreen />);

    expect(screen.getByText('Attempt 3')).toBeTruthy();
  });

  it('renders screen title', () => {
    render(<KycStatusScreen />);
    expect(screen.getByText('Identity Verification')).toBeTruthy();
  });
});

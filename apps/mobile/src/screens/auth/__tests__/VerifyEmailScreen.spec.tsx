/**
 * VerifyEmailScreen component tests.
 *
 * Validates email display, resend cooldown, and verified navigation.
 */

import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react-native';

import VerifyEmailScreen from '../VerifyEmailScreen';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VerifyEmailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render the provided email address', () => {
    render(<VerifyEmailScreen email="test@example.com" />);
    expect(screen.getByText('test@example.com')).toBeTruthy();
  });

  it('should render "Check your email" title', () => {
    render(<VerifyEmailScreen email="test@example.com" />);
    expect(screen.getByText('Check your email')).toBeTruthy();
  });

  it('should render resend button', () => {
    render(<VerifyEmailScreen email="test@example.com" />);
    expect(screen.getByText('Resend email')).toBeTruthy();
  });

  it('should call onResend when resend button is pressed', () => {
    const onResend = jest.fn();
    render(<VerifyEmailScreen email="test@example.com" onResend={onResend} />);

    fireEvent.press(screen.getByText('Resend email'));

    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('should start 60-second cooldown after resend', () => {
    const onResend = jest.fn();
    render(<VerifyEmailScreen email="test@example.com" onResend={onResend} />);

    fireEvent.press(screen.getByText('Resend email'));

    expect(screen.getByText('Resend in 60s')).toBeTruthy();
  });

  it('should disable resend button during cooldown', () => {
    render(<VerifyEmailScreen email="test@example.com" />);

    fireEvent.press(screen.getByText('Resend email'));

    const resendButton = screen.getByLabelText('Resend email available in 60 seconds');
    expect(resendButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('should show countdown text during cooldown', () => {
    render(<VerifyEmailScreen email="test@example.com" />);

    fireEvent.press(screen.getByText('Resend email'));

    // After 5 seconds, should show 55s remaining
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.getByText('Resend in 55s')).toBeTruthy();
  });

  it('should call onVerified when "I\'ve verified" button is pressed', () => {
    const onVerified = jest.fn();
    render(
      <VerifyEmailScreen email="test@example.com" onVerified={onVerified} />,
    );

    fireEvent.press(screen.getByText("I've verified my email"));

    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('should re-enable resend button after cooldown expires', () => {
    render(<VerifyEmailScreen email="test@example.com" />);

    fireEvent.press(screen.getByText('Resend email'));

    // Advance past the full 60-second cooldown
    act(() => {
      jest.advanceTimersByTime(60000);
    });

    expect(screen.getByText('Resend email')).toBeTruthy();
    const resendButton = screen.getByLabelText('Resend verification email');
    expect(resendButton.props.accessibilityState?.disabled).toBeFalsy();
  });
});

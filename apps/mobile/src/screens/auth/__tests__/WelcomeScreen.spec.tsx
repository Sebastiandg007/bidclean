/**
 * WelcomeScreen component tests.
 *
 * Validates brand rendering, button presence, and navigation callbacks.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

import WelcomeScreen from '../WelcomeScreen';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
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

describe('WelcomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render brand name "BidClean"', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('BidClean')).toBeTruthy();
  });

  it('should render tagline text', () => {
    render(<WelcomeScreen />);
    expect(
      screen.getByText('Fair prices. Verified pros. Instant match.'),
    ).toBeTruthy();
  });

  it('should render "Get Started" button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Get Started')).toBeTruthy();
  });

  it('should render "Log In" button', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Log In')).toBeTruthy();
  });

  it('should call onGetStarted when "Get Started" is pressed', () => {
    const onGetStarted = jest.fn();
    render(<WelcomeScreen onGetStarted={onGetStarted} />);

    fireEvent.press(screen.getByText('Get Started'));

    expect(onGetStarted).toHaveBeenCalledTimes(1);
  });

  it('should call onLogIn when "Log In" is pressed', () => {
    const onLogIn = jest.fn();
    render(<WelcomeScreen onLogIn={onLogIn} />);

    fireEvent.press(screen.getByText('Log In'));

    expect(onLogIn).toHaveBeenCalledTimes(1);
  });

  it('should fallback to router.push("/register") when no onGetStarted prop', () => {
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText('Get Started'));

    expect(mockPush).toHaveBeenCalledWith('/register');
  });

  it('should fallback to router.push("/login") when no onLogIn prop', () => {
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText('Log In'));

    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('should have correct accessibility labels on buttons', () => {
    render(<WelcomeScreen />);

    expect(
      screen.getByLabelText('Get Started — create a new account'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Log In to your existing account'),
    ).toBeTruthy();
  });
});

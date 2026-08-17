/**
 * BiometricSetupScreen component tests.
 *
 * Validates idle/generating/error states, skip behavior, and retry logic.
 */

import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

import BiometricSetupScreen from '../BiometricSetupScreen';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({ userId: 'test-user-123' }),
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

const mockGetRandomBytesAsync = jest.fn();
const mockDigestStringAsync = jest.fn();

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: (...args: unknown[]) => mockGetRandomBytesAsync(...args),
  digestStringAsync: (...args: unknown[]) => mockDigestStringAsync(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BiometricSetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRandomBytesAsync.mockResolvedValue(new Uint8Array(32));
    mockDigestStringAsync.mockResolvedValue('mocked-public-key-digest');
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('should render "Secure your account" title', () => {
    render(<BiometricSetupScreen />);
    expect(screen.getByText('Secure your account')).toBeTruthy();
  });

  it('should render "Enable Biometric" button in idle state', () => {
    render(<BiometricSetupScreen />);
    expect(screen.getByText('Enable Biometric')).toBeTruthy();
  });

  it('should render "Skip for now" button', () => {
    render(<BiometricSetupScreen />);
    expect(screen.getByText('Skip for now')).toBeTruthy();
  });

  it('should call onSkip when skip button is pressed', () => {
    const onSkip = jest.fn();
    render(<BiometricSetupScreen onSkip={onSkip} />);

    fireEvent.press(screen.getByText('Skip for now'));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('should show generating state when enable is pressed', async () => {
    // Make the key generation hang to capture the generating state
    mockGetRandomBytesAsync.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(new Uint8Array(32)), 5000)),
    );

    render(<BiometricSetupScreen />);

    fireEvent.press(screen.getByText('Enable Biometric'));

    await waitFor(() => {
      expect(screen.getByText('Generating secure keys…')).toBeTruthy();
    });
  });

  it('should show error state when key generation fails', async () => {
    mockGetRandomBytesAsync.mockRejectedValue(new Error('Crypto unavailable'));

    render(<BiometricSetupScreen />);

    fireEvent.press(screen.getByText('Enable Biometric'));

    await waitFor(() => {
      expect(screen.getByText('Crypto unavailable')).toBeTruthy();
    });
  });

  it('should show "Try again" button in error state', async () => {
    mockGetRandomBytesAsync.mockRejectedValue(new Error('Key gen failed'));

    render(<BiometricSetupScreen />);

    fireEvent.press(screen.getByText('Enable Biometric'));

    await waitFor(() => {
      expect(screen.getByText('Try again')).toBeTruthy();
    });
  });

  it('should handle retry by returning to idle state', async () => {
    // First attempt fails
    mockGetRandomBytesAsync.mockRejectedValueOnce(new Error('First failure'));

    render(<BiometricSetupScreen />);

    fireEvent.press(screen.getByText('Enable Biometric'));

    await waitFor(() => {
      expect(screen.getByText('Try again')).toBeTruthy();
    });

    // Press retry — the component calls handleRetry which resets to idle
    fireEvent.press(screen.getByText('Try again'));

    // Should be back in idle state with "Enable Biometric" visible
    await waitFor(() => {
      expect(screen.getByText('Enable Biometric')).toBeTruthy();
    });
  });
});

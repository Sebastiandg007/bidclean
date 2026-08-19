/**
 * HostOnboardingScreen — Component tests.
 *
 * Tests multi-step onboarding flow: name confirmation (step 1),
 * payment method setup (step 2), validation logic, and API submission.
 */

import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import HostOnboardingScreen from '../HostOnboardingScreen';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
  }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
      call: () => {},
    },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withSpring: (value: unknown) => value,
    withDelay: (_delay: number, value: unknown) => value,
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
    View,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const TEST_USER = {
  fullName: 'John Doe',
  id: 'user-1',
  email: 'john@example.com',
};

jest.mock('../../../stores/auth.store', () => ({
  useAuthStore: (selector: any) =>
    selector({
      user: { fullName: 'John Doe', id: 'user-1', email: 'john@example.com' },
    }),
}));

const mockPost = jest.fn().mockResolvedValue({ data: {} });

jest.mock('../../../services/api.service', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate from step 1 to step 2 (valid step 1 with pre-filled name) */
function advanceToStep2() {
  const continueButton = screen.getByLabelText('Continue to payment setup');
  fireEvent.press(continueButton);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HostOnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ data: {} });
  });

  // ─── Rendering (Step 1) ──────────────────────────────────────────────────

  describe('Rendering (Step 1)', () => {
    it('should render "Host setup" title', () => {
      render(<HostOnboardingScreen />);
      expect(screen.getByText('Host setup')).toBeTruthy();
    });

    it('should render step indicator showing "1/2"', () => {
      render(<HostOnboardingScreen />);
      expect(screen.getByText('1/2')).toBeTruthy();
    });

    it('should render "Confirm your name" step title', () => {
      render(<HostOnboardingScreen />);
      expect(screen.getByText('Confirm your name')).toBeTruthy();
    });

    it('should render display name input pre-filled with user fullName', () => {
      render(<HostOnboardingScreen />);
      const input = screen.getByLabelText('Display name input');
      expect(input.props.value).toBe(TEST_USER.fullName);
    });

    it('should render business toggle', () => {
      render(<HostOnboardingScreen />);
      expect(screen.getByLabelText('Toggle business account')).toBeTruthy();
    });

    it('should render Continue button', () => {
      render(<HostOnboardingScreen />);
      expect(screen.getByLabelText('Continue to payment setup')).toBeTruthy();
    });
  });

  // ─── Steps Navigation ────────────────────────────────────────────────────

  describe('Steps Navigation', () => {
    it('should advance to step 2 when Continue is pressed on valid step 1', () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByText('Payment method')).toBeTruthy();
    });

    it('should show "Payment method" title on step 2', () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByText('Payment method')).toBeTruthy();
    });

    it('should show step indicator "2/2" on step 2', () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByText('2/2')).toBeTruthy();
    });

    it('should show "Set up payment" and "Skip for now" buttons on step 2', () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByLabelText('Set up payment method')).toBeTruthy();
      expect(screen.getByLabelText('Skip payment setup for now')).toBeTruthy();
    });
  });

  // ─── Validation ──────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('should disable Continue when display name is empty', () => {
      render(<HostOnboardingScreen />);
      const input = screen.getByLabelText('Display name input');
      fireEvent.changeText(input, '');

      const button = screen.getByLabelText('Continue to payment setup');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('should enable Continue when display name has content', () => {
      render(<HostOnboardingScreen />);
      const button = screen.getByLabelText('Continue to payment setup');
      // Pre-filled with user fullName so should be enabled
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false }),
      );
    });

    it('should show business name input when toggle is enabled', () => {
      render(<HostOnboardingScreen />);
      const toggle = screen.getByLabelText('Toggle business account');
      fireEvent(toggle, 'valueChange', true);

      expect(screen.getByLabelText('Business name input')).toBeTruthy();
    });

    it('should disable Continue when business toggle is on but business name is empty', () => {
      render(<HostOnboardingScreen />);
      const toggle = screen.getByLabelText('Toggle business account');
      fireEvent(toggle, 'valueChange', true);

      const button = screen.getByLabelText('Continue to payment setup');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('should enable Continue when both display name and business name are filled (with toggle on)', () => {
      render(<HostOnboardingScreen />);
      const toggle = screen.getByLabelText('Toggle business account');
      fireEvent(toggle, 'valueChange', true);

      const businessInput = screen.getByLabelText('Business name input');
      fireEvent.changeText(businessInput, 'Clean Co.');

      const button = screen.getByLabelText('Continue to payment setup');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false }),
      );
    });
  });

  // ─── Submission ──────────────────────────────────────────────────────────

  describe('Submission', () => {
    it('should call apiClient.post with correct data when "Set up payment" is pressed', async () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();

      const setupButton = screen.getByLabelText('Set up payment method');
      fireEvent.press(setupButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/users/me/host-profile', {
          displayName: TEST_USER.fullName,
          isBusiness: false,
          businessName: undefined,
          paymentMethodAdded: true,
        });
      });
    });

    it('should call apiClient.post with paymentMethodAdded: false when "Skip for now" is pressed without onSkip', async () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();

      const skipButton = screen.getByLabelText('Skip payment setup for now');
      fireEvent.press(skipButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/users/me/host-profile', {
          displayName: TEST_USER.fullName,
          isBusiness: false,
          businessName: undefined,
          paymentMethodAdded: false,
        });
      });
    });

    it('should call onComplete callback after successful submission', async () => {
      const onComplete = jest.fn();
      render(<HostOnboardingScreen onComplete={onComplete} />);
      advanceToStep2();

      const setupButton = screen.getByLabelText('Set up payment method');
      fireEvent.press(setupButton);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });
    });

    it('should call onSkip callback when skip button pressed (if onSkip prop provided)', () => {
      const onSkip = jest.fn();
      render(<HostOnboardingScreen onSkip={onSkip} />);
      advanceToStep2();

      const skipButton = screen.getByLabelText('Skip payment setup for now');
      fireEvent.press(skipButton);

      expect(onSkip).toHaveBeenCalled();
    });

    it('should show "Saving..." text while submitting', async () => {
      // Make the API call hang so we can observe loading state
      mockPost.mockReturnValue(new Promise(() => {}));

      render(<HostOnboardingScreen />);
      advanceToStep2();

      const setupButton = screen.getByLabelText('Set up payment method');
      fireEvent.press(setupButton);

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeTruthy();
      });
    });

    it('should navigate to /host when no onComplete prop provided', async () => {
      render(<HostOnboardingScreen />);
      advanceToStep2();

      const setupButton = screen.getByLabelText('Set up payment method');
      fireEvent.press(setupButton);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/host');
      });
    });

    it('should show alert on API error', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPost.mockRejectedValue(new Error('Network failure'));

      render(<HostOnboardingScreen />);
      advanceToStep2();

      const setupButton = screen.getByLabelText('Set up payment method');
      fireEvent.press(setupButton);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Error', 'Network failure');
      });

      alertSpy.mockRestore();
    });
  });
});

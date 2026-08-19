/**
 * CleanerOnboardingScreen — Component tests.
 *
 * Tests multi-step onboarding flow:
 * Step 1: KYC verification trigger
 * Step 2: Work zone radius setup
 * Step 3: Availability picker (days + time slots)
 * Step 4: Specialties selection (optional, skippable)
 * Also tests API submission and error handling.
 */

import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CleanerOnboardingScreen from '../CleanerOnboardingScreen';

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
  fullName: 'Jane Cleaner',
  id: 'user-2',
  email: 'jane@example.com',
};

jest.mock('../../../stores/auth.store', () => ({
  useAuthStore: (selector: any) =>
    selector({
      user: { fullName: 'Jane Cleaner', id: 'user-2', email: 'jane@example.com' },
    }),
}));

const mockPost = jest.fn().mockResolvedValue({ data: {} });

jest.mock('../../../services/api.service', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Advance from Step 1 (KYC) to Step 2 (Work Zone) */
function advanceToStep2() {
  const button = screen.getByLabelText('Start verification and continue');
  fireEvent.press(button);
}

/** Advance from Step 1 to Step 3 (Availability) */
function advanceToStep3() {
  advanceToStep2();
  const button = screen.getByLabelText('Continue to availability setup');
  fireEvent.press(button);
}

/** Advance from Step 1 to Step 4 (Specialties) — requires at least one day+slot */
function advanceToStep4() {
  advanceToStep3();

  // Enable Monday
  const mondayChip = screen.getByLabelText('Monday');
  fireEvent.press(mondayChip);

  // Select morning slot for Monday
  const morningSlot = screen.getByLabelText('🌅 Morning on Monday');
  fireEvent.press(morningSlot);

  // Continue to step 4
  const button = screen.getByLabelText('Continue to specialties');
  fireEvent.press(button);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CleanerOnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ data: {} });
  });

  // ─── Rendering (Step 1 — KYC) ─────────────────────────────────────────────

  describe('Rendering (Step 1 — KYC)', () => {
    it('should render "Cleaner setup" title', () => {
      render(<CleanerOnboardingScreen />);
      expect(screen.getByText('Cleaner setup')).toBeTruthy();
    });

    it('should render step indicator showing "1/4"', () => {
      render(<CleanerOnboardingScreen />);
      expect(screen.getByText('1/4')).toBeTruthy();
    });

    it('should render "Identity verification" step title', () => {
      render(<CleanerOnboardingScreen />);
      expect(screen.getByText('Identity verification')).toBeTruthy();
    });

    it('should render KYC info cards', () => {
      render(<CleanerOnboardingScreen />);
      expect(screen.getByText('What you will need')).toBeTruthy();
      expect(screen.getByText('You can start working soon')).toBeTruthy();
    });

    it('should render "Start verification" button', () => {
      render(<CleanerOnboardingScreen />);
      expect(
        screen.getByLabelText('Start verification and continue'),
      ).toBeTruthy();
    });
  });

  // ─── Step 2 — Work Zone ────────────────────────────────────────────────────

  describe('Step 2 — Work Zone', () => {
    it('should advance to step 2 when Start verification is pressed', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByText('Set your work zone')).toBeTruthy();
    });

    it('should show step indicator "2/4"', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByText('2/4')).toBeTruthy();
    });

    it('should show radius input with default value of 5', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      const input = screen.getByLabelText('Work zone radius in kilometers');
      expect(input.props.value).toBe('5');
    });

    it('should show map placeholder with radius display', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      expect(screen.getByText('5 km')).toBeTruthy();
    });

    it('should update radius when valid number is entered', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      const input = screen.getByLabelText('Work zone radius in kilometers');
      fireEvent.changeText(input, '10');
      expect(screen.getByText('10 km')).toBeTruthy();
    });

    it('should not update radius for values outside range', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      const input = screen.getByLabelText('Work zone radius in kilometers');
      fireEvent.changeText(input, '100');
      // Should remain at default since 100 > MAX_RADIUS_KM (50)
      expect(screen.getByText('5 km')).toBeTruthy();
    });

    it('should render Continue button for work zone step', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep2();
      expect(
        screen.getByLabelText('Continue to availability setup'),
      ).toBeTruthy();
    });
  });

  // ─── Step 3 — Availability ─────────────────────────────────────────────────

  describe('Step 3 — Availability', () => {
    it('should advance to step 3 when Continue is pressed on step 2', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();
      expect(screen.getByText('Set your availability')).toBeTruthy();
    });

    it('should show step indicator "3/4"', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();
      expect(screen.getByText('3/4')).toBeTruthy();
    });

    it('should render all 7 days of the week as chips', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();
      expect(screen.getByLabelText('Monday')).toBeTruthy();
      expect(screen.getByLabelText('Tuesday')).toBeTruthy();
      expect(screen.getByLabelText('Wednesday')).toBeTruthy();
      expect(screen.getByLabelText('Thursday')).toBeTruthy();
      expect(screen.getByLabelText('Friday')).toBeTruthy();
      expect(screen.getByLabelText('Saturday')).toBeTruthy();
      expect(screen.getByLabelText('Sunday')).toBeTruthy();
    });

    it('should disable Continue button when no days are selected', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();
      const button = screen.getByLabelText('Continue to specialties');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('should show time slots when a day is toggled on', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();

      const mondayChip = screen.getByLabelText('Monday');
      fireEvent.press(mondayChip);

      expect(screen.getByLabelText('🌅 Morning on Monday')).toBeTruthy();
      expect(screen.getByLabelText('☀️ Afternoon on Monday')).toBeTruthy();
      expect(screen.getByLabelText('🌙 Evening on Monday')).toBeTruthy();
      expect(screen.getByLabelText('📅 Full day on Monday')).toBeTruthy();
    });

    it('should still disable Continue when day enabled but no slots selected', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();

      const mondayChip = screen.getByLabelText('Monday');
      fireEvent.press(mondayChip);

      const button = screen.getByLabelText('Continue to specialties');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('should enable Continue when a day has at least one slot selected', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();

      const mondayChip = screen.getByLabelText('Monday');
      fireEvent.press(mondayChip);

      const morningSlot = screen.getByLabelText('🌅 Morning on Monday');
      fireEvent.press(morningSlot);

      const button = screen.getByLabelText('Continue to specialties');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false }),
      );
    });

    it('should hide time slots when day is toggled off', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();

      const mondayChip = screen.getByLabelText('Monday');
      fireEvent.press(mondayChip); // Enable
      fireEvent.press(mondayChip); // Disable

      expect(
        screen.queryByLabelText('🌅 Morning on Monday'),
      ).toBeNull();
    });
  });

  // ─── Step 4 — Specialties ──────────────────────────────────────────────────

  describe('Step 4 — Specialties', () => {
    it('should advance to step 4 with valid availability', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();
      expect(screen.getByText('Add your specialties')).toBeTruthy();
    });

    it('should show step indicator "4/4"', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();
      expect(screen.getByText('4/4')).toBeTruthy();
    });

    it('should render all specialty chips', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();
      expect(screen.getByLabelText('🏠 Airbnb')).toBeTruthy();
      expect(screen.getByLabelText('🏢 Offices')).toBeTruthy();
      expect(screen.getByLabelText('🏡 Homes')).toBeTruthy();
      expect(screen.getByLabelText('🎉 Post-event')).toBeTruthy();
      expect(screen.getByLabelText('🧹 Deep cleaning')).toBeTruthy();
      expect(screen.getByLabelText('📦 Move in/out')).toBeTruthy();
    });

    it('should render "Complete setup" and "Skip for now" buttons', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();
      expect(
        screen.getByLabelText('Complete onboarding with specialties'),
      ).toBeTruthy();
      expect(screen.getByLabelText('Skip specialties for now')).toBeTruthy();
    });

    it('should toggle specialty selection on press', () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();

      const airbnbChip = screen.getByLabelText('🏠 Airbnb');
      fireEvent.press(airbnbChip);
      expect(airbnbChip.props.accessibilityState).toEqual(
        expect.objectContaining({ checked: true }),
      );

      fireEvent.press(airbnbChip);
      expect(airbnbChip.props.accessibilityState).toEqual(
        expect.objectContaining({ checked: false }),
      );
    });
  });

  // ─── Submission ────────────────────────────────────────────────────────────

  describe('Submission', () => {
    it('should call apiClient.post with correct data on "Complete setup"', async () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();

      // Select a specialty
      const airbnbChip = screen.getByLabelText('🏠 Airbnb');
      fireEvent.press(airbnbChip);

      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/users/me/cleaner-profile', {
          displayName: TEST_USER.fullName,
          workZoneLat: 0,
          workZoneLng: 0,
          workZoneRadiusKm: 5,
          availability: { monday: ['morning'] },
          specialties: ['airbnb'],
        });
      });
    });

    it('should call apiClient.post with empty specialties on "Skip for now" (no onSkip prop)', async () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();

      const skipButton = screen.getByLabelText('Skip specialties for now');
      fireEvent.press(skipButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/users/me/cleaner-profile', {
          displayName: TEST_USER.fullName,
          workZoneLat: 0,
          workZoneLng: 0,
          workZoneRadiusKm: 5,
          availability: { monday: ['morning'] },
          specialties: [],
        });
      });
    });

    it('should call onComplete callback after successful submission', async () => {
      const onComplete = jest.fn();
      render(<CleanerOnboardingScreen onComplete={onComplete} />);
      advanceToStep4();

      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });
    });

    it('should call onSkip callback when skip button pressed (if onSkip prop provided)', () => {
      const onSkip = jest.fn();
      render(<CleanerOnboardingScreen onSkip={onSkip} />);
      advanceToStep4();

      const skipButton = screen.getByLabelText('Skip specialties for now');
      fireEvent.press(skipButton);

      expect(onSkip).toHaveBeenCalled();
      // Should NOT call apiClient when onSkip is provided
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should show "Saving..." text while submitting', async () => {
      mockPost.mockReturnValue(new Promise(() => {}));

      render(<CleanerOnboardingScreen />);
      advanceToStep4();

      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeTruthy();
      });
    });

    it('should navigate to /cleaner when no onComplete prop provided', async () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep4();

      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/cleaner');
      });
    });

    it('should show alert on API error', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPost.mockRejectedValue(new Error('Network failure'));

      render(<CleanerOnboardingScreen />);
      advanceToStep4();

      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Error', 'Network failure');
      });

      alertSpy.mockRestore();
    });

    it('should include modified radius in submission', async () => {
      render(<CleanerOnboardingScreen />);

      // Step 1 → Step 2
      advanceToStep2();

      // Change radius to 15
      const radiusInput = screen.getByLabelText(
        'Work zone radius in kilometers',
      );
      fireEvent.changeText(radiusInput, '15');

      // Step 2 → Step 3
      const continueStep2 = screen.getByLabelText(
        'Continue to availability setup',
      );
      fireEvent.press(continueStep2);

      // Enable Monday + morning
      const mondayChip = screen.getByLabelText('Monday');
      fireEvent.press(mondayChip);
      const morningSlot = screen.getByLabelText('🌅 Morning on Monday');
      fireEvent.press(morningSlot);

      // Step 3 → Step 4
      const continueStep3 = screen.getByLabelText('Continue to specialties');
      fireEvent.press(continueStep3);

      // Complete
      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/users/me/cleaner-profile',
          expect.objectContaining({ workZoneRadiusKm: 15 }),
        );
      });
    });

    it('should include multiple availability days in submission', async () => {
      render(<CleanerOnboardingScreen />);
      advanceToStep3();

      // Enable Monday + morning
      const mondayChip = screen.getByLabelText('Monday');
      fireEvent.press(mondayChip);
      const morningMon = screen.getByLabelText('🌅 Morning on Monday');
      fireEvent.press(morningMon);

      // Enable Friday + evening
      const fridayChip = screen.getByLabelText('Friday');
      fireEvent.press(fridayChip);
      const eveningFri = screen.getByLabelText('🌙 Evening on Friday');
      fireEvent.press(eveningFri);

      // Step 3 → Step 4
      const continueBtn = screen.getByLabelText('Continue to specialties');
      fireEvent.press(continueBtn);

      // Complete
      const completeButton = screen.getByLabelText(
        'Complete onboarding with specialties',
      );
      fireEvent.press(completeButton);

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          '/users/me/cleaner-profile',
          expect.objectContaining({
            availability: {
              monday: ['morning'],
              friday: ['evening'],
            },
          }),
        );
      });
    });
  });
});

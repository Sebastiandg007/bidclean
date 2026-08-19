/**
 * RoleSelectionScreen — Component tests.
 *
 * Tests rendering of role cards, selection toggling,
 * and submission behavior (enabled/disabled, callback invocation).
 */

import { render, fireEvent, screen } from '@testing-library/react-native';

import RoleSelectionScreen from '../RoleSelectionScreen';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
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
    interpolateColor: (
      _progress: number,
      _inputRange: number[],
      outputRange: string[],
    ) => outputRange[0],
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RoleSelectionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Rendering ─────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('should render the title "Choose your role"', () => {
      render(<RoleSelectionScreen />);
      expect(screen.getByText('Choose your role')).toBeTruthy();
    });

    it('should render the subtitle text', () => {
      render(<RoleSelectionScreen />);
      expect(
        screen.getByText(
          'Select how you want to use BidClean. You can always add another role later.',
        ),
      ).toBeTruthy();
    });

    it('should render Host role card with correct title', () => {
      render(<RoleSelectionScreen />);
      expect(screen.getByText('I need cleaning')).toBeTruthy();
    });

    it('should render Cleaner role card with correct title', () => {
      render(<RoleSelectionScreen />);
      expect(screen.getByText('I want to work')).toBeTruthy();
    });

    it('should render Host role description', () => {
      render(<RoleSelectionScreen />);
      expect(
        screen.getByText('Find verified professionals for your property'),
      ).toBeTruthy();
    });

    it('should render Cleaner role description', () => {
      render(<RoleSelectionScreen />);
      expect(
        screen.getByText('Get jobs near you and earn on your schedule'),
      ).toBeTruthy();
    });

    it('should render the Continue button', () => {
      render(<RoleSelectionScreen />);
      expect(
        screen.getByLabelText('Continue with selected role'),
      ).toBeTruthy();
    });

    it('should render Continue button as disabled initially', () => {
      render(<RoleSelectionScreen />);
      const button = screen.getByLabelText('Continue with selected role');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });
  });

  // ─── Selection ─────────────────────────────────────────────────────────────

  describe('Selection', () => {
    it('should call onRoleToggled with (host, true) when Host card is tapped', () => {
      const onRoleToggled = jest.fn();
      render(<RoleSelectionScreen onRoleToggled={onRoleToggled} />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );
      fireEvent.press(hostCard);

      expect(onRoleToggled).toHaveBeenCalledWith('host', true);
    });

    it('should call onRoleToggled with (cleaner, true) when Cleaner card is tapped', () => {
      const onRoleToggled = jest.fn();
      render(<RoleSelectionScreen onRoleToggled={onRoleToggled} />);

      const cleanerCard = screen.getByLabelText(
        'I want to work \u2014 Get jobs near you and earn on your schedule',
      );
      fireEvent.press(cleanerCard);

      expect(onRoleToggled).toHaveBeenCalledWith('cleaner', true);
    });

    it('should allow selecting both roles', () => {
      const onRoleToggled = jest.fn();
      render(<RoleSelectionScreen onRoleToggled={onRoleToggled} />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );
      const cleanerCard = screen.getByLabelText(
        'I want to work \u2014 Get jobs near you and earn on your schedule',
      );

      fireEvent.press(hostCard);
      fireEvent.press(cleanerCard);

      expect(onRoleToggled).toHaveBeenCalledWith('host', true);
      expect(onRoleToggled).toHaveBeenCalledWith('cleaner', true);
    });

    it('should call onRoleToggled with (host, false) when deselecting Host', () => {
      const onRoleToggled = jest.fn();
      render(<RoleSelectionScreen onRoleToggled={onRoleToggled} />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );

      fireEvent.press(hostCard); // select
      fireEvent.press(hostCard); // deselect

      expect(onRoleToggled).toHaveBeenLastCalledWith('host', false);
    });

    it('should show checkmark when role is selected', () => {
      render(<RoleSelectionScreen />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );

      fireEvent.press(hostCard);

      expect(screen.getByText('\u2713')).toBeTruthy();
    });
  });

  // ─── Submission ────────────────────────────────────────────────────────────

  describe('Submission', () => {
    it('should have Continue button disabled when no roles selected', () => {
      render(<RoleSelectionScreen />);
      const button = screen.getByLabelText('Continue with selected role');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      );
    });

    it('should enable Continue button after selecting a role', () => {
      render(<RoleSelectionScreen />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );
      fireEvent.press(hostCard);

      const button = screen.getByLabelText('Continue with selected role');
      expect(button.props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false }),
      );
    });

    it('should call onSubmit with [host] when only host is selected', () => {
      const onSubmit = jest.fn();
      render(<RoleSelectionScreen onSubmit={onSubmit} />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );
      fireEvent.press(hostCard);

      const button = screen.getByLabelText('Continue with selected role');
      fireEvent.press(button);

      expect(onSubmit).toHaveBeenCalledWith(['host']);
    });

    it('should call onSubmit with [cleaner] when only cleaner is selected', () => {
      const onSubmit = jest.fn();
      render(<RoleSelectionScreen onSubmit={onSubmit} />);

      const cleanerCard = screen.getByLabelText(
        'I want to work \u2014 Get jobs near you and earn on your schedule',
      );
      fireEvent.press(cleanerCard);

      const button = screen.getByLabelText('Continue with selected role');
      fireEvent.press(button);

      expect(onSubmit).toHaveBeenCalledWith(['cleaner']);
    });

    it('should call onSubmit with both roles when both are selected', () => {
      const onSubmit = jest.fn();
      render(<RoleSelectionScreen onSubmit={onSubmit} />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );
      const cleanerCard = screen.getByLabelText(
        'I want to work \u2014 Get jobs near you and earn on your schedule',
      );

      fireEvent.press(hostCard);
      fireEvent.press(cleanerCard);

      const button = screen.getByLabelText('Continue with selected role');
      fireEvent.press(button);

      expect(onSubmit).toHaveBeenCalledWith(
        expect.arrayContaining(['host', 'cleaner']),
      );
      expect(onSubmit.mock.calls[0][0]).toHaveLength(2);
    });

    it('should not call onSubmit when no role is selected', () => {
      const onSubmit = jest.fn();
      render(<RoleSelectionScreen onSubmit={onSubmit} />);

      const button = screen.getByLabelText('Continue with selected role');
      fireEvent.press(button);

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should fallback to router.push when no onSubmit prop provided', () => {
      render(<RoleSelectionScreen />);

      const hostCard = screen.getByLabelText(
        'I need cleaning \u2014 Find verified professionals for your property',
      );
      fireEvent.press(hostCard);

      const button = screen.getByLabelText('Continue with selected role');
      fireEvent.press(button);

      expect(mockPush).toHaveBeenCalledWith('/onboarding');
    });
  });
});

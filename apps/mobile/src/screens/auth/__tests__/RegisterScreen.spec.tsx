/**
 * RegisterScreen component tests.
 *
 * Validates form inputs, picker modals, validation, and submission behavior.
 */

import { render, fireEvent, screen } from '@testing-library/react-native';

import RegisterScreen from '../RegisterScreen';

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

describe('RegisterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render title "Create your profile"', () => {
    render(<RegisterScreen />);
    expect(screen.getByText('Create your profile')).toBeTruthy();
  });

  it('should render full name input', () => {
    render(<RegisterScreen />);
    expect(screen.getByLabelText('Full name input')).toBeTruthy();
  });

  it('should show validation error when name is less than 2 characters', () => {
    render(<RegisterScreen />);

    const nameInput = screen.getByLabelText('Full name input');
    fireEvent.changeText(nameInput, 'A');

    expect(
      screen.getByText('Name must be at least 2 characters'),
    ).toBeTruthy();
  });

  it('should disable continue button when form is incomplete', () => {
    render(<RegisterScreen />);

    const continueButton = screen.getByLabelText('Continue to create account');
    expect(continueButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('should open country picker modal when country field is pressed', () => {
    render(<RegisterScreen />);

    fireEvent.press(screen.getByLabelText('Select your country'));

    expect(screen.getByText('Select Country')).toBeTruthy();
  });

  it('should open language picker modal when language field is pressed', () => {
    render(<RegisterScreen />);

    fireEvent.press(screen.getByLabelText('Select your preferred language'));

    expect(screen.getByText('Select Language')).toBeTruthy();
  });

  it('should call onContinue with form data when valid form is submitted', () => {
    const onContinue = jest.fn();
    render(<RegisterScreen onContinue={onContinue} />);

    // Fill in name
    const nameInput = screen.getByLabelText('Full name input');
    fireEvent.changeText(nameInput, 'John Doe');

    // Select country
    fireEvent.press(screen.getByLabelText('Select your country'));
    fireEvent.press(screen.getByLabelText('Select 🇨🇴 Colombia'));

    // Select language
    fireEvent.press(screen.getByLabelText('Select your preferred language'));
    fireEvent.press(screen.getByLabelText('Select Español'));

    // Submit
    fireEvent.press(screen.getByLabelText('Continue to create account'));

    expect(onContinue).toHaveBeenCalledWith({
      fullName: 'John Doe',
      country: 'CO',
      language: 'es',
    });
  });

  it('should enable continue button when all fields are filled', () => {
    render(<RegisterScreen />);

    // Fill in name
    const nameInput = screen.getByLabelText('Full name input');
    fireEvent.changeText(nameInput, 'John Doe');

    // Select country
    fireEvent.press(screen.getByLabelText('Select your country'));
    fireEvent.press(screen.getByLabelText('Select 🇨🇴 Colombia'));

    // Select language
    fireEvent.press(screen.getByLabelText('Select your preferred language'));
    fireEvent.press(screen.getByLabelText('Select Español'));

    const continueButton = screen.getByLabelText('Continue to create account');
    expect(continueButton.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('should filter items when searching in picker modal', () => {
    render(<RegisterScreen />);

    // Open country picker
    fireEvent.press(screen.getByLabelText('Select your country'));

    // Search for "Col"
    const searchInput = screen.getByLabelText('Search Select Country');
    fireEvent.changeText(searchInput, 'Col');

    // Colombia should be visible
    expect(screen.getByText('🇨🇴 Colombia')).toBeTruthy();

    // United States should not be visible
    expect(screen.queryByText('🇺🇸 United States')).toBeNull();
  });
});

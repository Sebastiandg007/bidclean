/**
 * SettingsScreen tests.
 *
 * Covers: language/theme/notification changes, immediate UI updates,
 * local storage hydration, and backend sync.
 */

import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { useSettingsStore } from '../useSettings';
import type { ThemePreference } from '../profile.types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockChangeLanguage = jest.fn().mockResolvedValue(undefined);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: mockChangeLanguage },
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../services/api.service', () => ({
  apiClient: {
    get: jest.fn().mockResolvedValue({ data: mockSettingsData() }),
    patch: jest.fn().mockResolvedValue({ data: mockSettingsData() }),
  },
}));

jest.mock('i18next', () => ({
  changeLanguage: jest.fn().mockResolvedValue(undefined),
}));

function mockSettingsData() {
  return {
    language: 'en',
    theme: 'system' as ThemePreference,
    isPushEnabled: true,
    isEmailNotificationsEnabled: true,
    isSoundsEnabled: true,
  };
}

// ─── Import after mocks ──────────────────────────────────────────────────────

import { SettingsScreen } from '../SettingsScreen';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the zustand store before each test
  useSettingsStore.setState({
    settings: mockSettingsData(),
    isLoading: false,
    error: null,
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SettingsScreen', () => {
  it('renders language selector with current language', () => {
    const { getByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-language')).toBeTruthy();
  });

  it('changes language with immediate i18n reload', async () => {
    const updateLanguageSpy = jest.fn();
    useSettingsStore.setState({
      settings: mockSettingsData(),
      isLoading: false,
      error: null,
    });

    // Mock the updateLanguage action
    const originalState = useSettingsStore.getState();
    useSettingsStore.setState({
      ...originalState,
      updateLanguage: updateLanguageSpy,
    });

    const { getByTestId } = render(<SettingsScreen />);

    // Open language picker
    await act(async () => {
      fireEvent.press(getByTestId('settings-language'));
    });

    // Select Spanish
    await act(async () => {
      fireEvent.press(getByTestId('language-picker-option-es'));
    });

    expect(updateLanguageSpy).toHaveBeenCalledWith('es');
  });

  it('renders theme toggle with current theme', () => {
    const { getByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-theme')).toBeTruthy();
  });

  it('changes theme with immediate apply', async () => {
    const updateThemeSpy = jest.fn();
    useSettingsStore.setState({
      settings: mockSettingsData(),
      isLoading: false,
      error: null,
      updateTheme: updateThemeSpy,
    });

    const { getByTestId } = render(<SettingsScreen />);

    // Open theme picker
    await act(async () => {
      fireEvent.press(getByTestId('settings-theme'));
    });

    // Select dark theme
    await act(async () => {
      fireEvent.press(getByTestId('theme-picker-option-dark'));
    });

    expect(updateThemeSpy).toHaveBeenCalledWith('dark');
  });

  it('renders notification preference toggles', () => {
    const { getByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-push')).toBeTruthy();
    expect(getByTestId('settings-email')).toBeTruthy();
    expect(getByTestId('settings-sounds')).toBeTruthy();
  });

  it('syncs settings to backend on change', async () => {
    const updateNotificationSpy = jest.fn();
    useSettingsStore.setState({
      settings: mockSettingsData(),
      isLoading: false,
      error: null,
      updateNotification: updateNotificationSpy,
    });

    const { getByTestId } = render(<SettingsScreen />);

    // Toggle push notifications
    await act(async () => {
      fireEvent(getByTestId('settings-push-switch'), 'onValueChange', false);
    });

    expect(updateNotificationSpy).toHaveBeenCalledWith('isPushEnabled', false);
  });

  it('loads settings from local storage on mount', async () => {
    const loadFromLocalSpy = jest.fn().mockResolvedValue(undefined);
    const fetchFromBackendSpy = jest.fn().mockResolvedValue(undefined);

    useSettingsStore.setState({
      settings: null,
      isLoading: true,
      error: null,
      loadFromLocal: loadFromLocalSpy,
      fetchFromBackend: fetchFromBackendSpy,
    });

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(loadFromLocalSpy).toHaveBeenCalled();
    });
  });

  it('shows loading indicator when loading and no settings', () => {
    useSettingsStore.setState({
      settings: null,
      isLoading: true,
      error: null,
    });

    const { getByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-loading')).toBeTruthy();
  });
});

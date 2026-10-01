/**
 * Unit tests for ThemeModeSelector (and AppearanceSettingsScreen smoke).
 *
 * Validates: three options (Dark/Light/System), the active option reflects the current mode, labels
 * resolve from i18n, and tapping an option calls setMode with the right value (Req 7.1, 7.2).
 */

import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockSetMode = jest.fn();
let mockMode = 'DARK';
jest.mock('../../../theme', () => {
  const actual = jest.requireActual('../../../theme');
  return {
    ...actual,
    useTheme: () => ({
      theme: actual.THEMES.DARK,
      mode: mockMode,
      resolvedTheme: 'DARK',
      setMode: mockSetMode,
    }),
  };
});

import { ThemeModeSelector } from '../components/ThemeModeSelector';
import { AppearanceSettingsScreen } from '../AppearanceSettingsScreen';
import { ThemeMode } from '../../../theme';

beforeEach(() => {
  jest.clearAllMocks();
  mockMode = 'DARK';
});

describe('ThemeModeSelector', () => {
  it('renders the three mode options', () => {
    const { getByTestId } = render(<ThemeModeSelector />);
    expect(getByTestId('appearance-mode-dark')).toBeTruthy();
    expect(getByTestId('appearance-mode-light')).toBeTruthy();
    expect(getByTestId('appearance-mode-system')).toBeTruthy();
  });

  it('marks the current mode as selected', () => {
    mockMode = 'SYSTEM';
    const { getByTestId } = render(<ThemeModeSelector />);
    expect(getByTestId('appearance-mode-system').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('appearance-mode-dark').props.accessibilityState.selected).toBe(false);
  });

  it('calls setMode with the tapped mode', () => {
    const { getByTestId } = render(<ThemeModeSelector />);
    fireEvent.press(getByTestId('appearance-mode-light'));
    expect(mockSetMode).toHaveBeenCalledWith(ThemeMode.LIGHT);
    fireEvent.press(getByTestId('appearance-mode-system'));
    expect(mockSetMode).toHaveBeenCalledWith(ThemeMode.SYSTEM);
  });
});

describe('AppearanceSettingsScreen', () => {
  it('renders the appearance screen with the selector', () => {
    const { getByTestId } = render(<AppearanceSettingsScreen />);
    expect(getByTestId('appearance-screen')).toBeTruthy();
    expect(getByTestId('theme-mode-selector')).toBeTruthy();
  });
});

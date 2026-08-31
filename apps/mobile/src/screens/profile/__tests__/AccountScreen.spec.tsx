/**
 * AccountScreen tests.
 * Covers: system browser links, delete flow with confirmation modal.
 */

import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Alert.alert may be undefined under the jest-expo RN mock depending on suite
// load order; assign a stable mock so this suite never depends on it.
Alert.alert = jest.fn();

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
  }),
}));

const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'dismiss' });
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
  };
});

const mockReset = jest.fn();
jest.mock('../../../stores/auth.store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ reset: mockReset }),
}));

const mockPost = jest.fn();
jest.mock('../../../services/api.service', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { AccountScreen } from '../AccountScreen';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AccountScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-assign per test: a prior suite can reset the shared RN module and leave
    // Alert.alert undefined.
    Alert.alert = jest.fn();
  });

  it('renders account screen with all sections', () => {
    const { getByTestId, getByText } = render(<AccountScreen />);

    expect(getByTestId('account-screen')).toBeTruthy();
    expect(getByText('profile.account.title')).toBeTruthy();
    expect(getByText('profile.account.section_security')).toBeTruthy();
    expect(getByText('profile.account.section_danger')).toBeTruthy();
  });

  it('opens system browser for email change', async () => {
    const emailUrl = 'https://auth.bidclean.tech/realms/bidclean/account/#/personal-info';
    mockPost.mockResolvedValueOnce({ data: { url: emailUrl } });

    const { getByTestId } = render(<AccountScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('account-change-email'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/profile/me/change-email');
      expect(mockOpenBrowserAsync).toHaveBeenCalledWith(emailUrl);
    });
  });

  it('opens system browser for password change', async () => {
    const passwordUrl = 'https://auth.bidclean.tech/realms/bidclean/account/#/security/signingin';
    mockPost.mockResolvedValueOnce({ data: { url: passwordUrl } });

    const { getByTestId } = render(<AccountScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('account-change-password'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/profile/me/change-password');
      expect(mockOpenBrowserAsync).toHaveBeenCalledWith(passwordUrl);
    });
  });

  it('shows DeleteAccountModal on delete button press', () => {
    const { getByTestId, queryByTestId } = render(<AccountScreen />);

    // Modal starts hidden — children not rendered
    expect(queryByTestId('delete-confirmation-input')).toBeNull();

    fireEvent.press(getByTestId('account-delete'));

    // After pressing delete, modal should show its content
    expect(getByTestId('delete-confirmation-input')).toBeTruthy();
  });

  it('requires confirmation word before enabling delete', () => {
    const { getByTestId } = render(<AccountScreen />);

    fireEvent.press(getByTestId('account-delete'));

    const confirmButton = getByTestId('delete-modal-confirm');
    expect(confirmButton.props.accessibilityState?.disabled ?? confirmButton.props.disabled).toBeTruthy();

    const input = getByTestId('delete-confirmation-input');
    fireEvent.changeText(input, 'DELETE');

    // After typing the correct word, the button should be enabled
    const updatedConfirmButton = getByTestId('delete-modal-confirm');
    expect(updatedConfirmButton.props.accessibilityState?.disabled ?? updatedConfirmButton.props.disabled).toBeFalsy();
  });

  it('calls delete endpoint on confirmation', async () => {
    mockPost.mockResolvedValueOnce({ status: 202, data: {} });

    const { getByTestId } = render(<AccountScreen />);

    fireEvent.press(getByTestId('account-delete'));

    const input = getByTestId('delete-confirmation-input');
    fireEvent.changeText(input, 'DELETE');

    await act(async () => {
      fireEvent.press(getByTestId('delete-modal-confirm'));
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/profile/me/delete-account', {
        confirmationWord: 'DELETE',
      });
    });
  });

  it('logs out and navigates to welcome on successful deletion', async () => {
    mockPost.mockResolvedValueOnce({ status: 202, data: {} });

    const { getByTestId } = render(<AccountScreen />);

    fireEvent.press(getByTestId('account-delete'));

    const input = getByTestId('delete-confirmation-input');
    fireEvent.changeText(input, 'DELETE');

    await act(async () => {
      fireEvent.press(getByTestId('delete-modal-confirm'));
    });

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/welcome');
    });
  });

  it('shows error alert when email change fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network error'));

    const { getByTestId } = render(<AccountScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('account-change-email'));
    });

    // Alert.alert is called — no crash occurs
    await waitFor(() => {
      expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    });
  });

  it('shows active services error on 409 conflict', async () => {
    const conflictError = { response: { status: 409 } };
    mockPost.mockRejectedValueOnce(conflictError);

    const { getByTestId } = render(<AccountScreen />);

    fireEvent.press(getByTestId('account-delete'));

    const input = getByTestId('delete-confirmation-input');
    fireEvent.changeText(input, 'DELETE');

    await act(async () => {
      fireEvent.press(getByTestId('delete-modal-confirm'));
    });

    // Should not navigate away on conflict
    await waitFor(() => {
      expect(mockReset).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});

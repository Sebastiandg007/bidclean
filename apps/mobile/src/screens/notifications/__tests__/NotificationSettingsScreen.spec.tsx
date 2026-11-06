/**
 * Render test for NotificationSettingsScreen (Task 15.4).
 * Feature: push-notifications — category toggle + save persists to the store.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { NotificationSettingsScreen } from '../NotificationSettingsScreen';
import { useNotificationsStore } from '../notifications.store';

jest.mock('../notifications.api', () => ({
  registerDeviceRequest: jest.fn(),
  updateConsentRequest: jest.fn(),
  unregisterDeviceRequest: jest.fn(),
  getPreferencesRequest: jest.fn().mockResolvedValue({
    categoryOptOut: {},
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursTimezone: null,
    language: null,
  }),
  updatePreferencesRequest: jest.fn().mockResolvedValue(undefined),
}));

describe('NotificationSettingsScreen', () => {
  beforeEach(() => {
    useNotificationsStore.getState().reset();
    jest.clearAllMocks();
  });

  it('renders a toggle row per category', () => {
    const { getByTestId } = render(<NotificationSettingsScreen />);
    for (const category of ['offers', 'payments', 'negotiation', 'messages', 'calls']) {
      expect(getByTestId(`category-row-${category}`)).toBeTruthy();
    }
  });

  it('saves preferences with a category opted out after toggling it off', async () => {
    const saveSpy = jest.spyOn(useNotificationsStore.getState(), 'savePreferences');
    const { getByTestId } = render(<NotificationSettingsScreen />);

    fireEvent(getByTestId('category-switch-offers'), 'valueChange', false);
    fireEvent.press(getByTestId('save-preferences'));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ categoryOptOut: expect.objectContaining({ offers: false }) }),
      );
    });
  });
});

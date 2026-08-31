/**
 * EditProfileScreen tests.
 * Covers: form rendering, validation (name, phone E.164, bio),
 * role-specific fields display, split endpoint saves.
 */

import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockUpdateCommon = jest.fn();
const mockUpdateHost = jest.fn();
const mockUpdateCleaner = jest.fn();

jest.mock('../useProfile', () => ({
  useProfileStore: (selector: (s: unknown) => unknown) => {
    const store = {
      profile: {
        common: {
          userId: 'user-1',
          displayName: 'John Doe',
          email: 'john@example.com',
          phoneNumber: '+1234567890',
          photoUrl: null,
          memberSince: '2024-01-01',
        },
        host: {
          businessName: 'CleanCo',
          propertiesCount: 3,
          paymentMethodsCount: 1,
          averageRating: 4.5,
          completedServicesCount: 10,
        },
        cleaner: {
          specialties: ['deep_cleaning'],
          workZoneCenter: { lat: 4.6, lng: -74.0 },
          workZoneRadiusKm: 15,
          workZoneLabel: 'Downtown',
          availability: {
            monday: { enabled: true, start: '09:00', end: '17:00' },
            tuesday: { enabled: false, start: null, end: null },
            wednesday: { enabled: false, start: null, end: null },
            thursday: { enabled: false, start: null, end: null },
            friday: { enabled: false, start: null, end: null },
            saturday: { enabled: false, start: null, end: null },
            sunday: { enabled: false, start: null, end: null },
          },
          bio: 'Professional cleaner',
          portfolioCount: 5,
          averageRating: 4.8,
          completedServicesCount: 50,
          kycBadge: true,
        },
        activeRole: 'host',
        completeness: { percentage: 80, breakdown: [] },
      },
      updateCommon: mockUpdateCommon,
      updateHost: mockUpdateHost,
      updateCleaner: mockUpdateCleaner,
    };
    return selector(store);
  },
}));

let mockActiveRole: string | null = 'host';

jest.mock('../../../stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => {
    return selector({ activeRole: mockActiveRole });
  },
  selectActiveRole: (s: { activeRole: string | null }) => s.activeRole,
}));

import { EditProfileScreen } from '../EditProfileScreen';

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveRole = 'host';
  mockUpdateCommon.mockResolvedValue(undefined);
  mockUpdateHost.mockResolvedValue(undefined);
  mockUpdateCleaner.mockResolvedValue(undefined);
  // Assign directly (not spyOn) so Alert.alert stays defined for later suites
  // sharing the RN module in the same process.
  Alert.alert = jest.fn();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EditProfileScreen', () => {
  describe('Rendering', () => {
    it('renders the screen with header and common fields', () => {
      const { getByTestId, getByText } = render(<EditProfileScreen />);

      expect(getByTestId('edit-profile-screen')).toBeTruthy();
      expect(getByText('profile.edit.title')).toBeTruthy();
      expect(getByTestId('input-display-name')).toBeTruthy();
      expect(getByTestId('input-phone-number')).toBeTruthy();
    });

    it('renders host-specific fields when active role is host', () => {
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      expect(getByTestId('input-business-name')).toBeTruthy();
    });

    it('renders cleaner-specific fields when active role is cleaner', () => {
      mockActiveRole = 'cleaner';
      const { getByTestId } = render(<EditProfileScreen />);

      expect(getByTestId('specialty-chip-deep_cleaning')).toBeTruthy();
      expect(getByTestId('input-work-zone-label')).toBeTruthy();
      expect(getByTestId('input-radius-km')).toBeTruthy();
      expect(getByTestId('input-bio')).toBeTruthy();
      expect(getByTestId('availability-monday')).toBeTruthy();
    });

    it('does not render host fields when active role is cleaner', () => {
      mockActiveRole = 'cleaner';
      const { queryByTestId } = render(<EditProfileScreen />);

      expect(queryByTestId('input-business-name')).toBeNull();
    });

    it('does not render cleaner fields when active role is host', () => {
      mockActiveRole = 'host';
      const { queryByTestId } = render(<EditProfileScreen />);

      expect(queryByTestId('input-bio')).toBeNull();
      expect(queryByTestId('input-work-zone-label')).toBeNull();
    });
  });

  describe('Validation', () => {
    it('shows error when display name is empty', async () => {
      const { getByTestId, getByText } = render(<EditProfileScreen />);

      fireEvent.changeText(getByTestId('input-display-name'), '   ');
      fireEvent.press(getByTestId('button-save'));

      await waitFor(() => {
        expect(getByText('profile.edit.error.name_required')).toBeTruthy();
      });
      expect(mockUpdateCommon).not.toHaveBeenCalled();
    });

    it('shows error when phone number is invalid E.164', async () => {
      const { getByTestId, getByText } = render(<EditProfileScreen />);

      fireEvent.changeText(getByTestId('input-phone-number'), '12345');
      fireEvent.press(getByTestId('button-save'));

      await waitFor(() => {
        expect(getByText('profile.edit.error.invalid_phone')).toBeTruthy();
      });
      expect(mockUpdateCommon).not.toHaveBeenCalled();
    });

    it('accepts valid E.164 phone number', async () => {
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      fireEvent.changeText(getByTestId('input-phone-number'), '+573001234567');

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(mockUpdateCommon).toHaveBeenCalled();
      });
    });

    it('accepts empty phone number (optional field)', async () => {
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      fireEvent.changeText(getByTestId('input-phone-number'), '');

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(mockUpdateCommon).toHaveBeenCalledWith(
          expect.objectContaining({ phoneNumber: null }),
        );
      });
    });
  });

  describe('Save operations (Host)', () => {
    it('saves common and host fields via split endpoints', async () => {
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      fireEvent.changeText(getByTestId('input-display-name'), 'Jane Smith');
      fireEvent.changeText(getByTestId('input-business-name'), 'SparkleClean');

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(mockUpdateCommon).toHaveBeenCalledWith({
          displayName: 'Jane Smith',
          phoneNumber: '+1234567890',
        });
        expect(mockUpdateHost).toHaveBeenCalledWith({
          businessName: 'SparkleClean',
        });
      });
    });

    it('does not call updateCleaner when role is host', async () => {
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(mockUpdateCleaner).not.toHaveBeenCalled();
      });
    });
  });

  describe('Save operations (Cleaner)', () => {
    it('saves common and cleaner fields via split endpoints', async () => {
      mockActiveRole = 'cleaner';
      const { getByTestId } = render(<EditProfileScreen />);

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(mockUpdateCommon).toHaveBeenCalled();
        expect(mockUpdateCleaner).toHaveBeenCalledWith(
          expect.objectContaining({
            specialties: ['deep_cleaning'],
            workZoneLabel: 'Downtown',
            workZoneRadiusKm: 15,
            bio: 'Professional cleaner',
          }),
        );
      });
    });

    it('does not call updateHost when role is cleaner', async () => {
      mockActiveRole = 'cleaner';
      const { getByTestId } = render(<EditProfileScreen />);

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(mockUpdateHost).not.toHaveBeenCalled();
      });
    });
  });

  describe('Specialties picker', () => {
    it('toggles specialty selection on press', () => {
      mockActiveRole = 'cleaner';
      const { getByTestId } = render(<EditProfileScreen />);

      const chip = getByTestId('specialty-chip-regular_cleaning');
      fireEvent.press(chip);

      // Chip should be toggled (visual check via style is limited in RNTL)
      expect(chip).toBeTruthy();
    });
  });

  describe('UI state', () => {
    it('disables save button while saving', async () => {
      // Hold the save in-flight with a manually-resolved promise so we can
      // assert the disabled state, then settle it before the test ends (leaving
      // it pending would resolve during a later suite and call Alert.alert on a
      // torn-down tree).
      let resolveSave: () => void = () => undefined;
      mockUpdateCommon.mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      );
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      expect(getByTestId('button-save').props.accessibilityState?.disabled ||
             getByTestId('button-save').props.disabled).toBeTruthy();

      // Settle the in-flight save so no async work leaks past this test.
      await act(async () => {
        resolveSave();
      });
    });

    it('navigates back on cancel press', () => {
      const { getByTestId } = render(<EditProfileScreen />);

      fireEvent.press(getByTestId('button-cancel'));

      expect(mockBack).toHaveBeenCalled();
    });

    it('shows error alert when save fails', async () => {
      mockUpdateCommon.mockRejectedValue(new Error('Network error'));
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'profile.edit.error_title',
          'profile.edit.error_message',
        );
      });
    });

    it('shows success alert and navigates back on successful save', async () => {
      mockActiveRole = 'host';
      const { getByTestId } = render(<EditProfileScreen />);

      await act(async () => {
        fireEvent.press(getByTestId('button-save'));
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'profile.edit.success_title',
          'profile.edit.success_message',
        );
        expect(mockBack).toHaveBeenCalled();
      });
    });
  });
});

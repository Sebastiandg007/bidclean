/**
 * ProfileScreen tests.
 *
 * Covers: role-based rendering, completeness display, role switch/add button,
 * loading state, and error state.
 */

import { render, screen } from '@testing-library/react-native';

import ProfileScreen from '../ProfileScreen';
import { useProfileStore } from '../useProfile';
import type { FullProfile } from '../profile.types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
  }),
}));

// Mock the auth store
const mockAuthState: { activeRole: 'host' | 'cleaner'; roles: Array<'host' | 'cleaner'> } = {
  activeRole: 'host',
  roles: ['host'],
};

jest.mock('../../../stores/auth.store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector(mockAuthState),
  selectActiveRole: (state: { activeRole: string }) => state.activeRole,
  selectHasBothRoles: (state: { roles: string[] }) => state.roles.length === 2,
  selectRoles: (state: { roles: string[] }) => state.roles,
}));

// ─── Test Data ───────────────────────────────────────────────────────────────

const mockHostProfile: FullProfile = {
  common: {
    userId: 'user-1',
    displayName: 'John Doe',
    email: 'john@example.com',
    phoneNumber: '+1234567890',
    photoUrl: null,
    memberSince: '2024-01-15T00:00:00Z',
  },
  host: {
    businessName: 'Doe Properties',
    propertiesCount: 3,
    paymentMethodsCount: 2,
    averageRating: 4.5,
    completedServicesCount: 12,
  },
  cleaner: null,
  activeRole: 'host',
  completeness: {
    percentage: 80,
    breakdown: [
      { field: 'displayName', completed: true, weight: 20 },
      { field: 'photo', completed: true, weight: 20 },
      { field: 'businessName', completed: true, weight: 20 },
      { field: 'paymentMethod', completed: true, weight: 20 },
      { field: 'firstProperty', completed: false, weight: 20 },
    ],
  },
};

const mockCleanerProfile: FullProfile = {
  common: {
    userId: 'user-2',
    displayName: 'Jane Smith',
    email: 'jane@example.com',
    phoneNumber: null,
    photoUrl: null,
    memberSince: '2024-03-10T00:00:00Z',
  },
  host: null,
  cleaner: {
    specialties: ['Deep cleaning', 'Move-out'],
    workZoneCenter: { lat: 40.7, lng: -74.0 },
    workZoneRadiusKm: 10,
    workZoneLabel: 'Manhattan, NY',
    availability: {
      monday: { enabled: true, start: '08:00', end: '18:00' },
      tuesday: { enabled: true, start: '08:00', end: '18:00' },
    },
    bio: 'Professional cleaner with 5 years experience.',
    portfolioCount: 8,
    averageRating: 4.8,
    completedServicesCount: 45,
    kycBadge: true,
  },
  activeRole: 'cleaner',
  completeness: {
    percentage: 95,
    breakdown: [],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Override store state AND set fetchProfile to no-op to prevent useEffect overriding it */
function setProfileStoreState(overrides: Partial<ReturnType<typeof useProfileStore.getState>>) {
  useProfileStore.setState({
    profile: null,
    isLoading: false,
    error: null,
    fetchProfile: jest.fn(),
    ...overrides,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.activeRole = 'host';
    mockAuthState.roles = ['host'];
    useProfileStore.setState({
      profile: null,
      isLoading: false,
      error: null,
      fetchProfile: jest.fn(),
    });
  });

  it('shows loading state while fetching profile', () => {
    setProfileStoreState({ isLoading: true, profile: null });

    render(<ProfileScreen />);

    expect(screen.getByTestId('profile-loading')).toBeTruthy();
    expect(screen.getByText('Loading profile...')).toBeTruthy();
  });

  it('shows error state when profile fetch fails', () => {
    setProfileStoreState({ error: 'Network error', profile: null });

    render(<ProfileScreen />);

    expect(screen.getByTestId('profile-error')).toBeTruthy();
    expect(screen.getByText('Could not load profile')).toBeTruthy();
    expect(screen.getByText('Network error')).toBeTruthy();
  });

  it('renders HostProfileCard when active role is host', () => {
    mockAuthState.activeRole = 'host';
    setProfileStoreState({ profile: mockHostProfile });

    render(<ProfileScreen />);

    expect(screen.getByTestId('profile-screen')).toBeTruthy();
    expect(screen.getByTestId('host-profile-card')).toBeTruthy();
    expect(screen.queryByTestId('cleaner-profile-card')).toBeNull();
  });

  it('renders CleanerProfileCard when active role is cleaner', () => {
    mockAuthState.activeRole = 'cleaner';
    mockAuthState.roles = ['cleaner'];
    setProfileStoreState({ profile: mockCleanerProfile });

    render(<ProfileScreen />);

    expect(screen.getByTestId('profile-screen')).toBeTruthy();
    expect(screen.getByTestId('cleaner-profile-card')).toBeTruthy();
    expect(screen.queryByTestId('host-profile-card')).toBeNull();
  });

  it('displays ProfileHeader with completeness data', () => {
    setProfileStoreState({ profile: mockHostProfile });

    render(<ProfileScreen />);

    expect(screen.getByTestId('profile-header')).toBeTruthy();
    expect(screen.getByTestId('completeness-ring')).toBeTruthy();
  });

  it('renders RoleSwitchButton when user has both roles', () => {
    mockAuthState.activeRole = 'host';
    mockAuthState.roles = ['host', 'cleaner'];
    setProfileStoreState({ profile: mockHostProfile });

    render(<ProfileScreen />);

    expect(screen.getByTestId('role-switch-button')).toBeTruthy();
    expect(screen.queryByTestId('add-second-role-button')).toBeNull();
  });

  it('renders AddSecondRoleButton when user has single role', () => {
    mockAuthState.activeRole = 'host';
    mockAuthState.roles = ['host'];
    setProfileStoreState({ profile: mockHostProfile });

    render(<ProfileScreen />);

    expect(screen.getByTestId('add-second-role-button')).toBeTruthy();
    expect(screen.queryByTestId('role-switch-button')).toBeNull();
  });
});

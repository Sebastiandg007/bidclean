/**
 * RoleBasedNavigator — Unit tests.
 *
 * Tests the routing logic: correct navigator for each role,
 * loading state during hydration, and redirect when no role is set.
 */

import { render, screen } from '@testing-library/react-native';

import RoleBasedNavigator from '../RoleBasedNavigator';
import { useRoleStore } from '../../stores/role.store';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: jest.fn(),
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setStoreState(overrides: Partial<ReturnType<typeof useRoleStore.getState>>) {
  useRoleStore.setState(overrides);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RoleBasedNavigator', () => {
  beforeEach(() => {
    useRoleStore.setState({
      activeRole: null,
      roles: [],
      isHydrated: false,
    });
  });

  it('renders loading indicator while not hydrated', () => {
    setStoreState({ isHydrated: false });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('role-navigator-loading')).toBeTruthy();
  });

  it('renders HostNavigator when activeRole is host', () => {
    setStoreState({ activeRole: 'host', roles: ['host'], isHydrated: true });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('host-navigator')).toBeTruthy();
    expect(screen.getByTestId('host-tab-bar')).toBeTruthy();
  });

  it('renders CleanerNavigator when activeRole is cleaner', () => {
    setStoreState({ activeRole: 'cleaner', roles: ['cleaner'], isHydrated: true });

    render(<RoleBasedNavigator />);

    expect(screen.getByText('Cleaner Experience')).toBeTruthy();
  });

  it('shows loading and triggers redirect when no active role and hydrated', () => {
    jest.useFakeTimers();
    const mockReplace = jest.fn();

    jest.spyOn(require('expo-router'), 'useRouter').mockReturnValue({
      replace: mockReplace,
    });

    setStoreState({ activeRole: null, roles: [], isHydrated: true });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('role-navigator-loading')).toBeTruthy();

    jest.runAllTimers();

    expect(mockReplace).toHaveBeenCalledWith('/roles/selection');

    jest.useRealTimers();
  });
});

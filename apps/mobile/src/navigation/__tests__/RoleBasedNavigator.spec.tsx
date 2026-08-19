/**
 * RoleBasedNavigator — Unit tests.
 *
 * Tests the routing logic: correct navigator for each role,
 * loading state during hydration, and redirect when no role is set.
 */

import { render, screen } from '@testing-library/react-native';

import RoleBasedNavigator from '../RoleBasedNavigator';
import { useAuthStore } from '../../stores/auth.store';

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

function setStoreState(overrides: Partial<ReturnType<typeof useAuthStore.getState>>) {
  useAuthStore.setState(overrides);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RoleBasedNavigator', () => {
  beforeEach(() => {
    useAuthStore.setState({
      activeRole: null,
      roles: [],
      isLoading: true,
    });
  });

  it('renders loading indicator while loading', () => {
    setStoreState({ isLoading: true });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('role-navigator-loading')).toBeTruthy();
  });

  it('renders HostNavigator when activeRole is host', () => {
    setStoreState({ activeRole: 'host', roles: ['host'], isLoading: false });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('host-navigator')).toBeTruthy();
    expect(screen.getByTestId('host-tab-bar')).toBeTruthy();
  });

  it('renders CleanerNavigator when activeRole is cleaner', () => {
    setStoreState({ activeRole: 'cleaner', roles: ['cleaner'], isLoading: false });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('cleaner-navigator')).toBeTruthy();
  });

  it('shows loading and triggers redirect when no active role and not loading', () => {
    jest.useFakeTimers();
    const mockReplace = jest.fn();

    jest.spyOn(require('expo-router'), 'useRouter').mockReturnValue({
      replace: mockReplace,
    });

    setStoreState({ activeRole: null, roles: [], isLoading: false });

    render(<RoleBasedNavigator />);

    expect(screen.getByTestId('role-navigator-loading')).toBeTruthy();

    jest.runAllTimers();

    expect(mockReplace).toHaveBeenCalledWith('/roles/selection');

    jest.useRealTimers();
  });
});

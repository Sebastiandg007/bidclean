/**
 * RoleBasedNavigator — Comprehensive component tests.
 *
 * Tests the routing logic: correct navigator for each role,
 * loading state during hydration, redirect when no role is set,
 * role switching (re-render), and separation of experiences (REQ-4).
 */

import { act, render, screen } from '@testing-library/react-native';

import RoleBasedNavigator from '../RoleBasedNavigator';
import { useAuthStore } from '../../stores/auth.store';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setStoreState(
  overrides: Partial<ReturnType<typeof useAuthStore.getState>>,
) {
  useAuthStore.setState(overrides);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RoleBasedNavigator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      activeRole: null,
      roles: [],
      isLoading: true,
    });
  });

  // ─── Loading State ─────────────────────────────────────────────────────────

  describe('Loading state', () => {
    it('should show loading indicator when isLoading is true', () => {
      setStoreState({ isLoading: true });

      render(<RoleBasedNavigator />);

      expect(screen.getByTestId('role-navigator-loading')).toBeTruthy();
    });

    it('should not render HostNavigator during loading', () => {
      setStoreState({
        isLoading: true,
        activeRole: 'host',
        roles: ['host'],
      });

      render(<RoleBasedNavigator />);

      expect(screen.queryByTestId('host-navigator')).toBeNull();
    });

    it('should not render CleanerNavigator during loading', () => {
      setStoreState({
        isLoading: true,
        activeRole: 'cleaner',
        roles: ['cleaner'],
      });

      render(<RoleBasedNavigator />);

      expect(screen.queryByTestId('cleaner-navigator')).toBeNull();
    });
  });

  // ─── Rendering Correct Navigator Per Role ──────────────────────────────────

  describe('Rendering correct navigator per role', () => {
    it('should render HostNavigator with 4 tabs when activeRole is host', () => {
      setStoreState({ activeRole: 'host', roles: ['host'], isLoading: false });

      render(<RoleBasedNavigator />);

      expect(screen.getByTestId('host-navigator')).toBeTruthy();
      expect(screen.getByTestId('host-tab-bar')).toBeTruthy();
      expect(screen.getByTestId('host-tab-home')).toBeTruthy();
      expect(screen.getByTestId('host-tab-properties')).toBeTruthy();
      expect(screen.getByTestId('host-tab-offers')).toBeTruthy();
      expect(screen.getByTestId('host-tab-profile')).toBeTruthy();
    });

    it('should render CleanerNavigator with 3 tabs when activeRole is cleaner', () => {
      setStoreState({
        activeRole: 'cleaner',
        roles: ['cleaner'],
        isLoading: false,
      });

      render(<RoleBasedNavigator />);

      expect(screen.getByTestId('cleaner-navigator')).toBeTruthy();
      expect(screen.getByTestId('cleaner-tab-bar')).toBeTruthy();
      expect(screen.getByTestId('cleaner-tab-radar')).toBeTruthy();
      expect(screen.getByTestId('cleaner-tab-active')).toBeTruthy();
      expect(screen.getByTestId('cleaner-tab-profile')).toBeTruthy();
    });

    it('should not render Cleaner tabs when activeRole is host', () => {
      setStoreState({ activeRole: 'host', roles: ['host'], isLoading: false });

      render(<RoleBasedNavigator />);

      expect(screen.queryByTestId('cleaner-navigator')).toBeNull();
      expect(screen.queryByTestId('cleaner-tab-bar')).toBeNull();
      expect(screen.queryByTestId('cleaner-tab-radar')).toBeNull();
      expect(screen.queryByTestId('cleaner-tab-active')).toBeNull();
      expect(screen.queryByTestId('cleaner-tab-profile')).toBeNull();
    });

    it('should not render Host tabs when activeRole is cleaner', () => {
      setStoreState({
        activeRole: 'cleaner',
        roles: ['cleaner'],
        isLoading: false,
      });

      render(<RoleBasedNavigator />);

      expect(screen.queryByTestId('host-navigator')).toBeNull();
      expect(screen.queryByTestId('host-tab-bar')).toBeNull();
      expect(screen.queryByTestId('host-tab-home')).toBeNull();
      expect(screen.queryByTestId('host-tab-properties')).toBeNull();
      expect(screen.queryByTestId('host-tab-offers')).toBeNull();
      expect(screen.queryByTestId('host-tab-profile')).toBeNull();
    });
  });

  // ─── Redirect Behavior ─────────────────────────────────────────────────────

  describe('Redirect behavior', () => {
    it('should show loading view when no activeRole and not loading', () => {
      setStoreState({ activeRole: null, roles: [], isLoading: false });

      render(<RoleBasedNavigator />);

      expect(screen.getByTestId('role-navigator-loading')).toBeTruthy();
    });

    it('should trigger redirect to /roles/selection when no activeRole and not loading', () => {
      jest.useFakeTimers();

      setStoreState({ activeRole: null, roles: [], isLoading: false });

      render(<RoleBasedNavigator />);

      jest.runAllTimers();

      expect(mockReplace).toHaveBeenCalledWith('/roles/selection');

      jest.useRealTimers();
    });

    it('should not render any navigator when no activeRole and not loading', () => {
      setStoreState({ activeRole: null, roles: [], isLoading: false });

      render(<RoleBasedNavigator />);

      expect(screen.queryByTestId('host-navigator')).toBeNull();
      expect(screen.queryByTestId('cleaner-navigator')).toBeNull();
    });
  });

  // ─── Role Switching (Re-render) ───────────────────────────────────────────

  describe('Role switching (re-render)', () => {
    it('should switch from HostNavigator to CleanerNavigator when activeRole changes', () => {
      setStoreState({
        activeRole: 'host',
        roles: ['host', 'cleaner'],
        isLoading: false,
      });

      const { rerender } = render(<RoleBasedNavigator />);

      expect(screen.getByTestId('host-navigator')).toBeTruthy();
      expect(screen.queryByTestId('cleaner-navigator')).toBeNull();

      // Simulate role switch
      act(() => {
        setStoreState({ activeRole: 'cleaner' });
      });

      rerender(<RoleBasedNavigator />);

      expect(screen.getByTestId('cleaner-navigator')).toBeTruthy();
      expect(screen.queryByTestId('host-navigator')).toBeNull();
    });

    it('should switch from CleanerNavigator to HostNavigator when activeRole changes', () => {
      setStoreState({
        activeRole: 'cleaner',
        roles: ['host', 'cleaner'],
        isLoading: false,
      });

      const { rerender } = render(<RoleBasedNavigator />);

      expect(screen.getByTestId('cleaner-navigator')).toBeTruthy();
      expect(screen.queryByTestId('host-navigator')).toBeNull();

      // Simulate role switch
      act(() => {
        setStoreState({ activeRole: 'host' });
      });

      rerender(<RoleBasedNavigator />);

      expect(screen.getByTestId('host-navigator')).toBeTruthy();
      expect(screen.queryByTestId('cleaner-navigator')).toBeNull();
    });
  });

  // ─── Separation of Experiences (REQ-4) ─────────────────────────────────────

  describe('Separation of experiences (REQ-4)', () => {
    it('should never show Cleaner tabs when in Host mode', () => {
      setStoreState({
        activeRole: 'host',
        roles: ['host', 'cleaner'],
        isLoading: false,
      });

      render(<RoleBasedNavigator />);

      // Host tabs are present
      expect(screen.getByTestId('host-tab-home')).toBeTruthy();
      expect(screen.getByTestId('host-tab-properties')).toBeTruthy();
      expect(screen.getByTestId('host-tab-offers')).toBeTruthy();
      expect(screen.getByTestId('host-tab-profile')).toBeTruthy();

      // Cleaner tabs are never visible
      expect(screen.queryByTestId('cleaner-tab-radar')).toBeNull();
      expect(screen.queryByTestId('cleaner-tab-active')).toBeNull();
      expect(screen.queryByTestId('cleaner-tab-profile')).toBeNull();
    });

    it('should never show Host tabs when in Cleaner mode', () => {
      setStoreState({
        activeRole: 'cleaner',
        roles: ['host', 'cleaner'],
        isLoading: false,
      });

      render(<RoleBasedNavigator />);

      // Cleaner tabs are present
      expect(screen.getByTestId('cleaner-tab-radar')).toBeTruthy();
      expect(screen.getByTestId('cleaner-tab-active')).toBeTruthy();
      expect(screen.getByTestId('cleaner-tab-profile')).toBeTruthy();

      // Host tabs are never visible
      expect(screen.queryByTestId('host-tab-home')).toBeNull();
      expect(screen.queryByTestId('host-tab-properties')).toBeNull();
      expect(screen.queryByTestId('host-tab-offers')).toBeNull();
      expect(screen.queryByTestId('host-tab-profile')).toBeNull();
    });
  });
});

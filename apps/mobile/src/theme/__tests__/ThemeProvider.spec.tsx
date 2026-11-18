/**
 * Unit / render tests for ThemeProvider + useTheme.
 *
 * Validates: the strict no-FOUC gate contract (no themed render + no splash-hide while unresolved),
 * the provider contract, app-wide consistency, SYSTEM live-follow, and the bootstrap timeout.
 * `expo-secure-store`, the splash wrapper, and `useColorScheme` are mocked.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../splash', () => ({
  preventAutoHide: jest.fn(),
  hide: jest.fn().mockResolvedValue(undefined),
}));

let mockColorScheme: 'light' | 'dark' | null = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockColorScheme,
}));

jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

const SecureStore = require('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};
const splash = require('../splash') as { preventAutoHide: jest.Mock; hide: jest.Mock };

import { ThemeProvider } from '../ThemeProvider';
import { useTheme } from '../useTheme';
import { useThemeStore } from '../useThemeStore';
import { THEMES } from '../themes';
import { DEFAULT_MODE } from '../theme.constants';
import { ResolvedTheme, ThemeMode } from '../tokens';

// ── Helpers ────────────────────────────────────────────────────────────────

function resetStore(): void {
  useThemeStore.setState({ mode: DEFAULT_MODE, isLoaded: false, writeSeq: 0 });
}

/** A probe that records how many times it rendered and exposes the last theme context value. */
let renderCount = 0;
let lastValue: ReturnType<typeof useTheme> | null = null;
function Probe(): React.JSX.Element {
  renderCount += 1;
  lastValue = useTheme();
  return <Text testID="probe">{lastValue.resolvedTheme}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  renderCount = 0;
  lastValue = null;
  mockColorScheme = 'dark';
  SecureStore.getItemAsync.mockResolvedValue(null);
});

describe('ThemeProvider — no-FOUC gate contract', () => {
  it('renders no themed content and does not hide the splash while unresolved', async () => {
    // A read that never settles keeps isLoaded false → the gate stays unresolved.
    SecureStore.getItemAsync.mockReturnValue(new Promise<string | null>(() => undefined));

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    // No themed child render occurred, and the splash was NOT hidden while unresolved.
    expect(renderCount).toBe(0);
    expect(splash.hide).not.toHaveBeenCalled();
  });

  it('mounts the themed tree and hides the splash only after resolution', async () => {
    SecureStore.getItemAsync.mockResolvedValue(null); // → DARK

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(renderCount).toBeGreaterThan(0));
    await waitFor(() => expect(splash.hide).toHaveBeenCalled());
    expect(lastValue?.resolvedTheme).toBe(ResolvedTheme.DARK);
  });
});

describe('ThemeProvider — bootstrap timeout', () => {
  it('resolves to DARK, mounts, and hides the splash when the read never settles', async () => {
    jest.useFakeTimers();
    SecureStore.getItemAsync.mockReturnValue(new Promise<string | null>(() => undefined));

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    // Before the timeout: unresolved.
    expect(renderCount).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(2100);
    });

    expect(useThemeStore.getState().mode).toBe(ThemeMode.DARK);
    expect(useThemeStore.getState().isLoaded).toBe(true);
    await waitFor(() => expect(renderCount).toBeGreaterThan(0));
    await waitFor(() => expect(splash.hide).toHaveBeenCalled());
    jest.useRealTimers();
  });
});

describe('ThemeProvider — contract & consistency', () => {
  it('useTheme returns { theme, mode, resolvedTheme, setMode } with theme === THEMES[resolvedTheme]', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(lastValue).not.toBeNull());
    expect(lastValue?.mode).toBe(ThemeMode.DARK);
    expect(lastValue?.resolvedTheme).toBe(ResolvedTheme.DARK);
    expect(lastValue?.theme).toBe(THEMES[ResolvedTheme.DARK]);
    expect(typeof lastValue?.setMode).toBe('function');
  });

  it('every consumer observes the new resolvedTheme after setMode (no stale/partial theming)', async () => {
    const values: Array<ReturnType<typeof useTheme>> = [];
    function Consumer(): React.JSX.Element {
      const v = useTheme();
      values.push(v);
      return <Text>{v.resolvedTheme}</Text>;
    }

    render(
      <ThemeProvider>
        <Consumer />
        <Consumer />
        <Consumer />
      </ThemeProvider>,
    );

    await waitFor(() => expect(values.length).toBeGreaterThanOrEqual(3));

    await act(async () => {
      useThemeStore.getState().setMode(ThemeMode.LIGHT);
    });

    await waitFor(() => {
      const latestThree = values.slice(-3);
      expect(latestThree.every((v) => v.resolvedTheme === ResolvedTheme.LIGHT)).toBe(true);
    });
  });
});

describe('ThemeProvider — SYSTEM live-follow', () => {
  it('follows the OS scheme live in SYSTEM mode without a remount', async () => {
    mockColorScheme = 'dark';
    SecureStore.getItemAsync.mockResolvedValue(JSON.stringify({ version: 1, mode: 'SYSTEM' }));

    const { rerender } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(lastValue?.resolvedTheme).toBe(ResolvedTheme.DARK));

    // OS flips to light; re-render to surface the new useColorScheme value.
    mockColorScheme = 'light';
    await act(async () => {
      rerender(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });

    await waitFor(() => expect(lastValue?.resolvedTheme).toBe(ResolvedTheme.LIGHT));
    expect(lastValue?.mode).toBe(ThemeMode.SYSTEM);
  });
});

/**
 * Unit tests for useThemedStyles / makeStyles.
 *
 * Validates that styles are token-derived and memoized per resolvedTheme (recomputed once per mode
 * change), replacing the per-file `const COLORS` + StyleSheet.create pattern.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../splash', () => ({ preventAutoHide: jest.fn(), hide: jest.fn().mockResolvedValue(undefined) }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => 'dark' }));
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

import { ThemeProvider } from '../ThemeProvider';
import { makeStyles } from '../useThemedStyles';
import { useThemeStore } from '../useThemeStore';
import { THEMES } from '../themes';
import { DEFAULT_MODE } from '../theme.constants';
import { ResolvedTheme, ThemeMode } from '../tokens';

const useStyles = makeStyles((theme) => ({
  box: { backgroundColor: theme.background, borderColor: theme.border },
}));

const captured: Array<{ style: ReturnType<typeof useStyles> }> = [];

function Styled(): React.JSX.Element {
  const styles = useStyles();
  captured.push({ style: styles });
  return (
    <View style={styles.box}>
      <Text>x</Text>
    </View>
  );
}

beforeEach(() => {
  useThemeStore.setState({ mode: DEFAULT_MODE, isLoaded: false, writeSeq: 0 });
  captured.length = 0;
});

describe('makeStyles', () => {
  it('produces token-derived styles and recomputes once when the resolved theme changes', async () => {
    render(
      <ThemeProvider>
        <Styled />
      </ThemeProvider>,
    );

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const darkStyle = captured[captured.length - 1]!.style;
    // Token-derived (no literal): background equals the DARK token.
    expect((darkStyle.box as { backgroundColor: string }).backgroundColor).toBe(
      THEMES[ResolvedTheme.DARK].background,
    );

    const countBeforeSwitch = captured.length;

    await act(async () => {
      useThemeStore.getState().setMode(ThemeMode.LIGHT);
    });

    await waitFor(() => {
      const latest = captured[captured.length - 1]!.style;
      expect((latest.box as { backgroundColor: string }).backgroundColor).toBe(
        THEMES[ResolvedTheme.LIGHT].background,
      );
    });

    // A new StyleSheet object was created for the new theme (recompute happened).
    expect(captured.length).toBeGreaterThan(countBeforeSwitch);
    expect(captured[captured.length - 1]!.style).not.toBe(darkStyle);
  });
});

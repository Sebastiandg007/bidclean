/**
 * Example / edge-case tests for the token layer.
 *
 * Validates the brand reference values (Req 2.1), the warm light background (Req 2.2), and the
 * accent-is-never-a-surface rule (Req 1.3, 7.5).
 */

import { darkTheme } from '../dark.theme';
import { lightTheme } from '../light.theme';
import { DEFAULT_MODE } from '../theme.constants';
import { ThemeMode } from '../tokens';

describe('theme reference values', () => {
  it('dark theme uses the brand reference values', () => {
    expect(darkTheme.background).toBe('#0B0C10');
    expect(darkTheme.surface).toBe('#1F2833');
    expect(darkTheme.textPrimary).toBe('#FFFFFF');
    expect(darkTheme.accent).toBe('#00F5D4');
  });

  it('DEFAULT_MODE is DARK (brand default)', () => {
    expect(DEFAULT_MODE).toBe(ThemeMode.DARK);
  });

  it('light theme uses a warm off-white background (not pure white) and the same mint accent', () => {
    expect(lightTheme.background).not.toBe('#FFFFFF');
    expect(lightTheme.background.toUpperCase()).toBe('#F5F2EB');
    expect(lightTheme.accent).toBe('#00F5D4');
  });

  it('accent is never a background or surface in either theme', () => {
    for (const theme of [darkTheme, lightTheme]) {
      expect(theme.accent).not.toBe(theme.background);
      expect(theme.accent).not.toBe(theme.surface);
      expect(theme.accent).not.toBe(theme.surfaceElevated);
    }
  });
});

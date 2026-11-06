/**
 * useSystemChromeTheme.ts — applies the resolved theme to native chrome the RN component tree
 * cannot style directly.
 *
 *  - Status bar: `light` content on DARK, `dark` content on LIGHT (via `expo-status-bar`'s
 *    imperative `setStatusBarStyle`).
 *  - Android navigation bar: color / button style where controllable (via `expo-navigation-bar`,
 *    applied defensively — skipped gracefully when the module is unavailable or on iOS).
 *  - Keyboard appearance default is surfaced via `keyboardAppearanceForTheme` for text inputs.
 *
 * OS-level dialogs the app cannot style are out of scope. Every controllable surface tracks the
 * theme; an unavailable API is skipped, never thrown.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { setStatusBarStyle } from 'expo-status-bar';

import { THEMES } from './themes';
import { ResolvedTheme } from './tokens';

/** The `keyboardAppearance` value a text input should use for a resolved theme. */
export function keyboardAppearanceForTheme(resolved: ResolvedTheme): 'dark' | 'light' {
  return resolved === ResolvedTheme.DARK ? 'dark' : 'light';
}

/** Apply the Android navigation bar color/button style defensively (no-op when unavailable). */
function applyAndroidNavigationBar(resolved: ResolvedTheme): void {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const navBar = require('expo-navigation-bar') as {
      setBackgroundColorAsync?: (color: string) => Promise<void>;
      setButtonStyleAsync?: (style: 'light' | 'dark') => Promise<void>;
    };
    const theme = THEMES[resolved];
    void navBar.setBackgroundColorAsync?.(theme.background);
    void navBar.setButtonStyleAsync?.(resolved === ResolvedTheme.DARK ? 'light' : 'dark');
  } catch {
    // Module unavailable in this build — skip gracefully.
  }
}

/** Drive native chrome from the resolved theme. Re-runs whenever the resolved theme changes. */
export function useSystemChromeTheme(resolved: ResolvedTheme): void {
  useEffect(() => {
    // On DARK the bars sit on a dark background → light content; on LIGHT → dark content.
    setStatusBarStyle(resolved === ResolvedTheme.DARK ? 'light' : 'dark');
    applyAndroidNavigationBar(resolved);
  }, [resolved]);
}

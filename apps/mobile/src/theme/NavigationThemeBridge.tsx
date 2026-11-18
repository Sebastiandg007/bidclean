/**
 * NavigationThemeBridge.tsx — maps the resolved theme onto a React Navigation theme so headers,
 * the tab bar, and card/modal presentation surfaces reflect the active theme.
 *
 * `toNavigationTheme(resolved)` is a pure token → React-Navigation-`Theme` mapping (token-derived
 * colors only, no literals) and is unit-tested directly. The component applies it via React
 * Navigation's `ThemeProvider` when that library is available, and otherwise renders its children
 * unchanged (this app currently uses custom navigators; the bridge is forward-compatible and never
 * a hard dependency).
 */

import React from 'react';

import { THEMES } from './themes';
import { ResolvedTheme } from './tokens';

/** One React Navigation font entry. */
interface NavigationFont {
  fontFamily: string;
  fontWeight: '400' | '500' | '600' | '700' | '800' | '900' | 'normal' | 'bold';
}

/** The React Navigation 7 `Theme` shape we populate (v7 requires `fonts`). */
export interface NavigationTheme {
  dark: boolean;
  colors: {
    primary: string;
    background: string;
    card: string;
    text: string;
    border: string;
    notification: string;
  };
  fonts: {
    regular: NavigationFont;
    medium: NavigationFont;
    bold: NavigationFont;
    heavy: NavigationFont;
  };
}

/**
 * System font set used when React Navigation's own defaults are unavailable. React
 * Navigation 7 reads `theme.fonts.regular` etc. while rendering headers and scenes;
 * a theme without `fonts` crashes with "Cannot read property 'regular' of undefined".
 */
const SYSTEM_FONTS: NavigationTheme['fonts'] = {
  regular: { fontFamily: 'sans-serif', fontWeight: 'normal' },
  medium: { fontFamily: 'sans-serif-medium', fontWeight: 'normal' },
  bold: { fontFamily: 'sans-serif', fontWeight: '600' },
  heavy: { fontFamily: 'sans-serif', fontWeight: '700' },
};

/** Pure mapping from a resolved theme to a React Navigation theme (token-derived colors). */
export function toNavigationTheme(
  resolved: ResolvedTheme,
  fonts: NavigationTheme['fonts'] = SYSTEM_FONTS,
): NavigationTheme {
  const theme = THEMES[resolved];
  return {
    dark: resolved === ResolvedTheme.DARK,
    colors: {
      primary: theme.accent,
      background: theme.background,
      card: theme.surface,
      text: theme.textPrimary,
      border: theme.border,
      notification: theme.danger,
    },
    fonts,
  };
}

interface NavigationModule {
  ThemeProvider: React.ComponentType<{ value: NavigationTheme; children: React.ReactNode }>;
  fonts: NavigationTheme['fonts'];
}

/** Resolve React Navigation's ThemeProvider + default fonts; `null` when the library is unavailable. */
function loadNavigationModule(): NavigationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nav = require('@react-navigation/native') as {
      ThemeProvider?: NavigationModule['ThemeProvider'];
      DefaultTheme?: { fonts?: NavigationTheme['fonts'] };
    };
    if (!nav.ThemeProvider) {
      return null;
    }
    return { ThemeProvider: nav.ThemeProvider, fonts: nav.DefaultTheme?.fonts ?? SYSTEM_FONTS };
  } catch {
    return null;
  }
}

const navigationModule = loadNavigationModule();

export function NavigationThemeBridge({
  resolved,
  children,
}: {
  resolved: ResolvedTheme;
  children: React.ReactNode;
}): React.JSX.Element {
  if (navigationModule === null) {
    return <>{children}</>;
  }
  const { ThemeProvider: NavThemeProvider, fonts } = navigationModule;
  return <NavThemeProvider value={toNavigationTheme(resolved, fonts)}>{children}</NavThemeProvider>;
}

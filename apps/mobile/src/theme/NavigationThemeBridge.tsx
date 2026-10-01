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

/** The minimal React Navigation `Theme` shape we populate. */
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
}

/** Pure mapping from a resolved theme to a React Navigation theme (token-derived only). */
export function toNavigationTheme(resolved: ResolvedTheme): NavigationTheme {
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
  };
}

/** Resolve React Navigation's ThemeProvider defensively; `null` when the library is unavailable. */
function loadNavigationThemeProvider(): React.ComponentType<{
  value: NavigationTheme;
  children: React.ReactNode;
}> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nav = require('@react-navigation/native') as {
      ThemeProvider?: React.ComponentType<{ value: NavigationTheme; children: React.ReactNode }>;
    };
    return nav.ThemeProvider ?? null;
  } catch {
    return null;
  }
}

const NavThemeProvider = loadNavigationThemeProvider();

export function NavigationThemeBridge({
  resolved,
  children,
}: {
  resolved: ResolvedTheme;
  children: React.ReactNode;
}): React.JSX.Element {
  if (NavThemeProvider === null) {
    return <>{children}</>;
  }
  return <NavThemeProvider value={toNavigationTheme(resolved)}>{children}</NavThemeProvider>;
}

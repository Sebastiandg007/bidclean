/**
 * Unit tests for native chrome mapping.
 *
 * Validates: status bar content ('light' on DARK, 'dark' on LIGHT), the React Navigation theme
 * descriptor per resolved theme, and the keyboard appearance mapping (Req 4.4 · REQ-TH8). The
 * status bar and Android nav bar APIs are mocked; OS dialogs are untouched.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));

const statusBar = require('expo-status-bar') as { setStatusBarStyle: jest.Mock };

import {
  useSystemChromeTheme,
  keyboardAppearanceForTheme,
} from '../useSystemChromeTheme';
import { toNavigationTheme } from '../NavigationThemeBridge';
import { THEMES } from '../themes';
import { ResolvedTheme } from '../tokens';

function ChromeHost({ resolved }: { resolved: ResolvedTheme }): React.JSX.Element | null {
  useSystemChromeTheme(resolved);
  return null;
}

describe('useSystemChromeTheme — status bar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DARK → light status-bar content', () => {
    render(<ChromeHost resolved={ResolvedTheme.DARK} />);
    expect(statusBar.setStatusBarStyle).toHaveBeenCalledWith('light');
  });

  it('LIGHT → dark status-bar content', () => {
    render(<ChromeHost resolved={ResolvedTheme.LIGHT} />);
    expect(statusBar.setStatusBarStyle).toHaveBeenCalledWith('dark');
  });
});

describe('keyboardAppearanceForTheme', () => {
  it('maps DARK → dark and LIGHT → light', () => {
    expect(keyboardAppearanceForTheme(ResolvedTheme.DARK)).toBe('dark');
    expect(keyboardAppearanceForTheme(ResolvedTheme.LIGHT)).toBe('light');
  });
});

describe('toNavigationTheme', () => {
  it('produces a token-derived React Navigation theme for each resolved theme', () => {
    const dark = toNavigationTheme(ResolvedTheme.DARK);
    expect(dark.dark).toBe(true);
    expect(dark.colors.background).toBe(THEMES[ResolvedTheme.DARK].background);
    expect(dark.colors.card).toBe(THEMES[ResolvedTheme.DARK].surface);
    expect(dark.colors.primary).toBe(THEMES[ResolvedTheme.DARK].accent);
    expect(dark.colors.text).toBe(THEMES[ResolvedTheme.DARK].textPrimary);

    const light = toNavigationTheme(ResolvedTheme.LIGHT);
    expect(light.dark).toBe(false);
    expect(light.colors.background).toBe(THEMES[ResolvedTheme.LIGHT].background);
  });
});

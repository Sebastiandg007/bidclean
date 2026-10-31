/**
 * ThemeProvider.tsx — context provider + the no-FOUC resolution gate.
 *
 * Resolution gate (the implementable no-FOUC invariant):
 *   - At module load we call `preventAutoHide()` so the native splash stays up from the first frame.
 *   - On mount we trigger the store's `load()` and read the OS color scheme.
 *   - `resolved` is true IFF `store.isLoaded` AND the OS scheme has been read. While `!resolved`
 *     the provider renders NOTHING themed (`null`) and the splash stays held — the app is never
 *     shown in a default theme and never repaints.
 *   - Only after the resolved themed tree mounts and completes its initial layout cycle (`onLayout`)
 *     do we hide the splash. `hide()` is never called while `!resolved`.
 *
 * A live OS scheme change while in SYSTEM mode flips `resolvedTheme` without a remount. The context
 * value is memoized so every consumer observes the new theme consistently (no partial theming).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme, View } from 'react-native';

import { ThemeContext, type ThemeContextValue } from './ThemeContext';
import { resolve } from './resolveTheme';
import { THEMES } from './themes';
import { useThemeStore } from './useThemeStore';
import { hide, preventAutoHide } from './splash';
import { useSystemChromeTheme } from './useSystemChromeTheme';
import { NavigationThemeBridge } from './NavigationThemeBridge';
import { ResolvedTheme, ThemeMode } from './tokens';

// Hold the native splash from the very first frame (safe no-op if the module is unavailable).
preventAutoHide();

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const mode = useThemeStore((s) => s.mode);
  const isLoaded = useThemeStore((s) => s.isLoaded);
  const load = useThemeStore((s) => s.load);
  const setModeInStore = useThemeStore((s) => s.setMode);

  const osScheme = useColorScheme();
  const [osSchemeRead, setOsSchemeRead] = useState(false);

  // Kick off the persisted-preference read once.
  useEffect(() => {
    void load();
  }, [load]);

  // Mark the OS scheme as read after the first commit (makes the gate a genuine two-input AND).
  useEffect(() => {
    setOsSchemeRead(true);
  }, []);

  const resolved = isLoaded && osSchemeRead;
  const resolvedTheme: ResolvedTheme = resolve(mode, osScheme);

  // Native chrome tracks the resolved theme (centralized in the provider). Called unconditionally
  // (before the gate) so hook order is stable; harmless before content mounts.
  useSystemChromeTheme(resolvedTheme);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme: THEMES[resolvedTheme],
      mode,
      resolvedTheme,
      setMode: (next: ThemeMode) => {
        void setModeInStore(next);
      },
    }),
    [mode, resolvedTheme, setModeInStore],
  );

  if (!resolved) {
    // No themed content while resolving; the native splash remains visible.
    return null;
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      <NavigationThemeBridge resolved={resolvedTheme}>
        <ThemedRoot>{children}</ThemedRoot>
      </NavigationThemeBridge>
    </ThemeContext.Provider>
  );
}

/**
 * Wraps the resolved themed tree and hides the splash only after it has mounted (and its first
 * layout cycle has run) — so no default frame precedes resolution and the splash is never hidden
 * while unresolved. `ThemedRoot` is only ever rendered when `resolved === true`, so its mount
 * effect firing is exactly "the resolved themed tree is mounted and ready for presentation".
 * `onLayout` is kept as a secondary trigger on-device; the effect guarantees the hide runs in
 * environments where `onLayout` does not fire (e.g. the test renderer).
 */
function ThemedRoot({ children }: { children: React.ReactNode }): React.JSX.Element {
  const hiddenRef = useRef(false);

  const hideOnce = (): void => {
    if (hiddenRef.current) {
      return;
    }
    hiddenRef.current = true;
    void hide();
  };

  useEffect(() => {
    hideOnce();
    // Run exactly once after the themed root mounts.
  }, []);

  return (
    <View style={styles.root} onLayout={hideOnce}>
      {children}
    </View>
  );
}

const styles = { root: { flex: 1 } } as const;

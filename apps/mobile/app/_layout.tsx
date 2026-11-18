/**
 * app/_layout.tsx — the expo-router root layout.
 *
 * Hosts the app-wide provider tree above the navigation tree, so every route
 * renders inside the theme system:
 *
 *   SafeAreaProvider > ThemeProvider > (NavigationThemeBridge inside ThemeProvider) > Stack
 *
 * `ThemeProvider` holds the native splash until the persisted mode + OS scheme
 * resolve (no FOUC), drives native chrome from the resolved theme, and re-renders
 * the whole app on a mode change. Routing is delegated to the expo-router `Stack`;
 * each screen lives under `app/` and is mounted by its own route file.
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { RootErrorBoundary } from './error-boundary';
import { ThemeProvider } from '../src/theme';

// i18n initialization is isolated so a failure here cannot blank the whole app.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../src/i18n');
} catch {
  // i18n falls back to inline defaultValues; the boundary surfaces other errors.
}

export default function RootLayout(): React.JSX.Element {
  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}

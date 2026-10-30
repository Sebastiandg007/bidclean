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

import '../src/i18n';
import { ThemeProvider } from '../src/theme';

export default function RootLayout(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

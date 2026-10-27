/**
 * app/_layout.tsx — the expo-router root layout.
 *
 * This is where the app-wide provider tree lives, above the navigation tree, so every screen and
 * the navigation container render inside the theme system:
 *
 *   SafeAreaProvider > ThemeProvider > (NavigationThemeBridge, applied inside ThemeProvider) > app
 *
 * `ThemeProvider` holds the native splash until the persisted mode + OS scheme resolve (no FOUC),
 * drives native chrome from the resolved theme, and re-renders the whole app on a mode change.
 * `RoleBasedNavigator` is the existing root navigation component and is wrapped unchanged.
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '../src/theme';
import RoleBasedNavigator from '../src/navigation/RoleBasedNavigator';

export default function RootLayout(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RoleBasedNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

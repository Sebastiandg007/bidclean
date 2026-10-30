/**
 * app/index.tsx — the entry route.
 *
 * Hydrates the persisted session once, then decides the first screen:
 *   - authenticated + active role  → the role-based app (tabs)
 *   - authenticated, no role yet   → role selection
 *   - no session                   → Welcome (landing)
 *
 * Hydration failure degrades to the Welcome screen rather than a blank screen.
 */

import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';

import { useTheme } from '../src/theme';
import {
  useAuthStore,
  selectIsAuthenticated,
  selectActiveRole,
} from '../src/stores/auth.store';
import WelcomeScreen from '../src/screens/auth/WelcomeScreen';

export default function Index(): React.JSX.Element {
  const { theme } = useTheme();
  const hydrate = useAuthStore((s) => s.hydrate);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const activeRole = useAuthStore(selectActiveRole);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    hydrate()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setHydrated(true);
        }
      });
    return () => {
      active = false;
    };
  }, [hydrate]);

  if (!hydrated) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}
        accessibilityRole="progressbar"
      >
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (isAuthenticated && activeRole) {
    return <Redirect href="/home" />;
  }

  if (isAuthenticated && !activeRole) {
    return <Redirect href="/roles/selection" />;
  }

  return <WelcomeScreen />;
}

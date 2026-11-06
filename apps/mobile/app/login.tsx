/**
 * app/login.tsx — login route.
 *
 * Drives the Keycloak OAuth2 (Authorization Code + PKCE) system-browser flow via
 * `useOAuth`. On success it seeds the auth store and routes into the app; on
 * failure it shows the error and a retry. This route owns no credentials — the
 * token exchange happens server-side through the BidClean API callback.
 */

import React, { useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { makeStyles, useTheme } from '../src/theme';
import { useOAuth } from '../src/screens/auth/useOAuth';
import { useAuthStore } from '../src/stores/auth.store';

export default function LoginRoute(): React.JSX.Element {
  const router = useRouter();
  const styles = useStyles();
  const { theme } = useTheme();
  const { startLogin, isLoading, error } = useOAuth();
  const login = useAuthStore((s) => s.login);

  const handleLogin = useCallback(async () => {
    const result = await startLogin();
    if (!result) {
      return;
    }
    login(
      {
        accessToken: result.tokens.access_token,
        refreshToken: result.tokens.refresh_token,
        expiresAt: Date.now() + result.tokens.expires_in * 1000,
      },
      {
        id: result.user.id,
        keycloakId: result.user.keycloak_id,
        email: result.user.email,
        fullName: result.user.full_name,
        country: '',
        language: '',
        isEmailVerified: result.user.is_email_verified,
      },
    );
    router.replace('/roles/selection');
  }, [startLogin, login, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Log In</Text>
        <Text style={styles.subtitle}>Continue with your BidClean account.</Text>

        <Pressable style={styles.button} onPress={handleLogin} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.error}>{error.message}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((theme) => ({
  container: { flex: 1, backgroundColor: theme.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700', color: theme.textPrimary },
  subtitle: { fontSize: 16, color: theme.textSecondary, marginBottom: 16 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '600', color: theme.onAccent },
  error: { color: theme.danger, fontSize: 14, marginTop: 8 },
}));

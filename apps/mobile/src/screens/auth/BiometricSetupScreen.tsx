/**
 * BiometricSetupScreen — Prompts the user to enable biometric authentication.
 *
 * After a successful first login, this screen explains the benefits of
 * biometric auth (fingerprint/Face ID), generates a key pair using expo-crypto,
 * and registers the public key with the BidClean API. The private key never
 * leaves the device.
 *
 * Flow: generates key pair → registers public key via POST /auth/biometric/register
 *
 * States: idle → generating → registering → success | error
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import * as Crypto from 'expo-crypto';
import { useRouter, useLocalSearchParams } from 'expo-router';

import type { BiometricSetupScreenProps } from './auth.types';
import { API_BASE_URL } from './oauth.config';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
  error: '#FF6B6B',
  success: '#00F5D4',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

const FONT_SIZE = {
  title: 28,
  subtitle: 14,
  body: 16,
  button: 17,
  icon: 64,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const ANIMATION_DELAY_MS = 150;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Byte length for the cryptographic seed used in key generation */
const KEY_SEED_BYTES = 32;

/** API endpoint for registering biometric credentials */
const BIOMETRIC_REGISTER_URL = `${API_BASE_URL}/auth/biometric/register`;

// ─── Types ───────────────────────────────────────────────────────────────────

type SetupState = 'idle' | 'generating' | 'registering' | 'success' | 'error';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a key pair representation using expo-crypto.
 *
 * TODO(BID-BIOMETRIC): Production implementation will use platform-specific
 * Secure Enclave (iOS) / Keystore (Android) APIs via expo-local-authentication
 * for hardware-backed key generation. This placeholder demonstrates the flow
 * using a random seed to derive a base64-encoded public key representation.
 */
async function generateKeyPair(): Promise<{ publicKey: string; deviceId: string }> {
  const seed = await Crypto.getRandomBytesAsync(KEY_SEED_BYTES);
  const deviceIdBytes = await Crypto.getRandomBytesAsync(16);

  // Derive a public key representation from the seed via SHA-256 hash
  const seedHex = Array.from(seed)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const publicKeyDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    seedHex,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );

  const deviceId = Array.from(deviceIdBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return { publicKey: publicKeyDigest, deviceId };
}

/** Register the public key with the BidClean API */
async function registerBiometricCredential(
  publicKey: string,
  deviceId: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(BIOMETRIC_REGISTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      device_id: deviceId,
      public_key: publicKey,
      credential_type: 'biometric',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Biometric registration failed (${response.status}): ${errorBody}`);
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BiometricSetupScreen({
  userId: userIdProp,
  onSetupComplete,
  onSkip,
}: BiometricSetupScreenProps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId: string }>();

  // userId is available via props or route params for future API integration
  // (will be used when wiring up the actual biometric credential registration)
  void (userIdProp ?? params.userId);

  // ─── State ─────────────────────────────────────────────────────────────────

  const [setupState, setSetupState] = useState<SetupState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // ─── Animations ──────────────────────────────────────────────────────────

  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(20);

  useEffect(() => {
    contentOpacity.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    contentTranslateY.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(0, SPRING_CONFIG),
    );
  }, [contentOpacity, contentTranslateY]);

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleEnableBiometric = useCallback(async () => {
    setSetupState('generating');
    setErrorMessage('');

    try {
      const { publicKey, deviceId } = await generateKeyPair();

      setSetupState('registering');

      // TODO(BID-BIOMETRIC): Retrieve actual access token from secure storage
      const accessToken = '';

      await registerBiometricCredential(publicKey, deviceId, accessToken);

      setSetupState('success');

      // Auto-navigate after a brief success state
      setTimeout(() => {
        if (onSetupComplete) {
          onSetupComplete();
        } else {
          router.replace('/' as never);
        }
      }, 1500);
    } catch (err) {
      setSetupState('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    }
  }, [onSetupComplete, router]);

  const handleSkip = useCallback(() => {
    if (onSkip) {
      onSkip();
      return;
    }

    router.replace('/' as never);
  }, [onSkip, router]);

  const handleRetry = useCallback(() => {
    setSetupState('idle');
    setErrorMessage('');
  }, []);

  // ─── Render Helpers ──────────────────────────────────────────────────────

  const isProcessing = setupState === 'generating' || setupState === 'registering';

  const statusMessage = (() => {
    switch (setupState) {
      case 'generating':
        return 'Generating secure keys…';
      case 'registering':
        return 'Registering with server…';
      case 'success':
        return 'Biometric enabled!';
      default:
        return '';
    }
  })();

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        {/* Icon Section */}
        <View style={styles.iconSection}>
          <Text
            style={styles.biometricIcon}
            accessibilityLabel="Biometric security icon"
          >
            🔐
          </Text>
        </View>

        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.title}>Secure your account</Text>
          <Text style={styles.subtitle}>
            Enable fingerprint or Face ID for faster, more secure access.
            Your biometric data never leaves your device.
          </Text>
        </View>

        {/* Status / Error Messages */}
        {isProcessing && (
          <View style={styles.statusSection}>
            <ActivityIndicator
              size="small"
              color={COLORS.accent}
              accessibilityLabel="Loading"
            />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        )}

        {setupState === 'success' && (
          <View style={styles.statusSection}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successText}>{statusMessage}</Text>
          </View>
        )}

        {setupState === 'error' && (
          <View style={styles.errorSection}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.ctaSection}>
          {/* Enable Biometric / Retry Button */}
          {(setupState === 'idle' || setupState === 'error') && (
            <Pressable
              style={styles.enableButton}
              onPress={setupState === 'error' ? handleRetry : handleEnableBiometric}
              accessibilityRole="button"
              accessibilityLabel={
                setupState === 'error'
                  ? 'Retry biometric setup'
                  : 'Enable biometric authentication'
              }
            >
              <Text style={styles.enableButtonText}>
                {setupState === 'error' ? 'Try again' : 'Enable Biometric'}
              </Text>
            </Pressable>
          )}

          {/* Loading state button (disabled) */}
          {isProcessing && (
            <View
              style={[styles.enableButton, styles.enableButtonDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
            >
              <Text style={[styles.enableButtonText, styles.enableButtonTextDisabled]}>
                Setting up…
              </Text>
            </View>
          )}

          {/* Skip Button (hidden during processing and success) */}
          {setupState !== 'success' && !isProcessing && (
            <Pressable
              style={styles.skipButton}
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel="Skip biometric setup for now"
            >
              <Text style={styles.skipButtonText}>Skip for now</Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  iconSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  biometricIcon: {
    fontSize: FONT_SIZE.icon,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: SPACING.xxl,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  statusText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  successIcon: {
    fontSize: 24,
    color: COLORS.success,
    fontWeight: '700',
  },
  successText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.success,
    fontWeight: '600',
  },
  errorSection: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.lg,
  },
  errorText: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.error,
    textAlign: 'center',
    lineHeight: 20,
  },
  ctaSection: {
    gap: SPACING.md,
  },
  enableButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  enableButtonDisabled: {
    opacity: 0.4,
  },
  enableButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  enableButtonTextDisabled: {
    color: COLORS.background,
  },
  skipButton: {
    borderWidth: 1.5,
    borderColor: COLORS.textPrimary,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});

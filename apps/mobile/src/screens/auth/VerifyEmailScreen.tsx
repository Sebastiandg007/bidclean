/**
 * VerifyEmailScreen — Prompts the user to verify their email address.
 *
 * Displays a "Check your email" message with the target address,
 * a resend button with a 60-second cooldown timer, and a button
 * to proceed once the user has verified via the link/code sent by Keycloak.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';

import type { VerifyEmailScreenProps } from './auth.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
  error: '#FF6B6B',
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
  timer: 14,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const ANIMATION_DELAY_MS = 150;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Seconds the user must wait before requesting another verification email */
const RESEND_COOLDOWN_SECONDS = 60;

// ─── Component ───────────────────────────────────────────────────────────────

export default function VerifyEmailScreen({
  email: emailProp,
  onResend,
  onVerified,
}: VerifyEmailScreenProps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ email: string }>();

  // Prefer prop over route param — supports both direct usage and navigation
  const email = emailProp ?? params.email ?? '';

  // ─── Cooldown State ────────────────────────────────────────────────────────

  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCooldownActive = cooldownRemaining > 0;

  /** Start the 60-second cooldown countdown */
  const startCooldown = useCallback(() => {
    setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
  }, []);

  // Tick down once per second while cooldown is active
  useEffect(() => {
    if (!isCooldownActive) return;

    intervalRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isCooldownActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

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

  const handleResend = useCallback(() => {
    if (isCooldownActive) return;

    startCooldown();

    if (onResend) {
      onResend();
      return;
    }

    // Placeholder: actual resend API call will be wired in a separate task
  }, [isCooldownActive, startCooldown, onResend]);

  const handleVerified = useCallback(() => {
    if (onVerified) {
      onVerified();
      return;
    }

    router.push('/biometric-setup' as never);
  }, [onVerified, router]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        {/* Icon Section */}
        <View style={styles.iconSection}>
          <Text
            style={styles.emailIcon}
            accessibilityLabel="Email verification icon"
          >
            ✉️
          </Text>
        </View>

        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a verification link to
          </Text>
          <Text
            style={styles.emailText}
            accessibilityLabel={`Verification sent to ${email}`}
          >
            {email}
          </Text>
          <Text style={styles.helperText}>
            Click the link in the email to verify your account. The link expires
            in 15 minutes.
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.ctaSection}>
          {/* Resend Button */}
          <Pressable
            style={[
              styles.resendButton,
              isCooldownActive && styles.resendButtonDisabled,
            ]}
            onPress={handleResend}
            disabled={isCooldownActive}
            accessibilityRole="button"
            accessibilityLabel={
              isCooldownActive
                ? `Resend email available in ${cooldownRemaining} seconds`
                : 'Resend verification email'
            }
            accessibilityState={{ disabled: isCooldownActive }}
          >
            <Text
              style={[
                styles.resendButtonText,
                isCooldownActive && styles.resendButtonTextDisabled,
              ]}
            >
              {isCooldownActive
                ? `Resend in ${cooldownRemaining}s`
                : 'Resend email'}
            </Text>
          </Pressable>

          {/* Continue Button */}
          <Pressable
            style={styles.continueButton}
            onPress={handleVerified}
            accessibilityRole="button"
            accessibilityLabel="I've verified my email, continue to next step"
          >
            <Text style={styles.continueButtonText}>
              I've verified my email
            </Text>
          </Pressable>
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
  emailIcon: {
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
  },
  emailText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.accent,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  helperText: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
    textAlign: 'center',
    lineHeight: 20,
  },
  ctaSection: {
    gap: SPACING.md,
  },
  resendButton: {
    borderWidth: 1.5,
    borderColor: COLORS.textPrimary,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  resendButtonDisabled: {
    borderColor: COLORS.border,
    opacity: 0.5,
  },
  resendButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  resendButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
  continueButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  continueButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
});

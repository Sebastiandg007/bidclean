/**
 * WelcomeScreen — Landing screen for BidClean.
 *
 * Displays the brand logo with a spring animation on mount,
 * plus "Get Started" (primary) and "Log In" (secondary) CTAs.
 */

import { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  AccessibilityRole,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';

import type { WelcomeScreenProps } from './auth.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
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
  brand: 36,
  tagline: 16,
  button: 17,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const ANIMATION_DELAY_MS = 200;

// ─── Component ───────────────────────────────────────────────────────────────

export default function WelcomeScreen({ onGetStarted, onLogIn }: WelcomeScreenProps) {
  const router = useRouter();

  // Shared values for logo entrance animation (scale + opacity)
  const logoScale = useSharedValue(0.6);
  const logoOpacity = useSharedValue(0);

  useEffect(() => {
    logoScale.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    logoOpacity.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
  }, [logoScale, logoOpacity]);

  const logoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }));

  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
      return;
    }
    router.push('/register' as never);
  };

  const handleLogIn = () => {
    if (onLogIn) {
      onLogIn();
      return;
    }
    router.push('/login' as never);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Logo / Brand Section */}
      <View style={styles.heroSection}>
        <Animated.View style={[styles.logoContainer, logoAnimatedStyle]}>
          <Text style={styles.brandText}>BidClean</Text>
          <Text style={styles.tagline}>
            Fair prices. Verified pros. Instant match.
          </Text>
        </Animated.View>
      </View>

      {/* CTA Section */}
      <View style={styles.ctaSection}>
        <Pressable
          style={styles.primaryButton}
          onPress={handleGetStarted}
          accessibilityRole={'button' as AccessibilityRole}
          accessibilityLabel="Get Started — create a new account"
        >
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={handleLogIn}
          accessibilityRole={'button' as AccessibilityRole}
          accessibilityLabel="Log In to your existing account"
        >
          <Text style={styles.secondaryButtonText}>Log In</Text>
        </Pressable>
      </View>
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
  heroSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  brandText: {
    fontSize: FONT_SIZE.brand,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: FONT_SIZE.tagline,
    color: COLORS.textPrimary,
    opacity: 0.7,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  ctaSection: {
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: COLORS.textPrimary,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});

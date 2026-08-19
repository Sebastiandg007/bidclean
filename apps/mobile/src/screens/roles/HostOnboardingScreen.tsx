/**
 * HostOnboardingScreen — Multi-step onboarding for Host role.
 *
 * Step 1: Confirm personal/business name (pre-filled from registration).
 * Step 2: Payment method setup (informational — actual Stripe integration
 *         is handled in the `stripe-escrow` spec).
 *
 * On completion, calls POST /users/me/host-profile then navigates
 * to the Host main view.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';

import type { HostOnboardingScreenProps } from './roles.types';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../services/api.service';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
  error: '#FF6B6B',
  inputBackground: '#141920',
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
  label: 15,
  input: 16,
  button: 17,
  cardTitle: 18,
  cardDescription: 14,
  stepIndicator: 13,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const ENTRANCE_DELAY_MS = 100;

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 2;
const STEP_NAME_CONFIRMATION = 1;
const STEP_PAYMENT_METHOD = 2;

const HOST_PROFILE_ENDPOINT = '/users/me/host-profile';

// ─── Step Indicator Component ────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <View
      style={styles.stepIndicatorContainer}
      accessibilityRole="text"
      accessibilityLabel={`Step ${currentStep} of ${totalSteps}`}
    >
      {Array.from({ length: totalSteps }, (_, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;

        return (
          <View
            key={stepNumber}
            style={[
              styles.stepDot,
              isActive && styles.stepDotActive,
              isCompleted && styles.stepDotCompleted,
            ]}
          />
        );
      })}
      <Text style={styles.stepText}>
        {currentStep}/{totalSteps}
      </Text>
    </View>
  );
}

// ─── Name Confirmation Step ──────────────────────────────────────────────────

interface NameStepProps {
  displayName: string;
  isBusiness: boolean;
  businessName: string;
  onDisplayNameChange: (value: string) => void;
  onBusinessToggle: (value: boolean) => void;
  onBusinessNameChange: (value: string) => void;
  onContinue: () => void;
}

function NameConfirmationStep({
  displayName,
  isBusiness,
  businessName,
  onDisplayNameChange,
  onBusinessToggle,
  onBusinessNameChange,
  onContinue,
}: NameStepProps) {
  const isValid = displayName.trim().length > 0 &&
    (!isBusiness || businessName.trim().length > 0);

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.stepContent}
    >
      <Text style={styles.stepTitle}>Confirm your name</Text>
      <Text style={styles.stepDescription}>
        This is how hosts and guests will see you on BidClean.
      </Text>

      {/* Display Name Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Display name</Text>
        <TextInput
          style={styles.textInput}
          value={displayName}
          onChangeText={onDisplayNameChange}
          placeholder="Your full name"
          placeholderTextColor={COLORS.textSecondary}
          autoCapitalize="words"
          accessibilityLabel="Display name input"
          accessibilityRole="text"
        />
      </View>

      {/* Business Toggle */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>This is a business</Text>
        <Switch
          value={isBusiness}
          onValueChange={onBusinessToggle}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          accessibilityLabel="Toggle business account"
          accessibilityRole="switch"
          accessibilityState={{ checked: isBusiness }}
        />
      </View>

      {/* Conditional Business Name Input */}
      {isBusiness && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={styles.inputGroup}
        >
          <Text style={styles.inputLabel}>Business name</Text>
          <TextInput
            style={styles.textInput}
            value={businessName}
            onChangeText={onBusinessNameChange}
            placeholder="Your business name"
            placeholderTextColor={COLORS.textSecondary}
            autoCapitalize="words"
            accessibilityLabel="Business name input"
            accessibilityRole="text"
          />
        </Animated.View>
      )}

      {/* Continue Button */}
      <View style={styles.stepButtonContainer}>
        <Pressable
          style={[
            styles.primaryButton,
            !isValid && styles.primaryButtonDisabled,
          ]}
          onPress={onContinue}
          disabled={!isValid}
          accessibilityRole="button"
          accessibilityLabel="Continue to payment setup"
          accessibilityState={{ disabled: !isValid }}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !isValid && styles.primaryButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Payment Method Step ─────────────────────────────────────────────────────

interface PaymentStepProps {
  onSetupPayment: () => void;
  onSkip: () => void;
  isSubmitting: boolean;
}

function PaymentMethodStep({
  onSetupPayment,
  onSkip,
  isSubmitting,
}: PaymentStepProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.stepContent}
    >
      <Text style={styles.stepTitle}>Payment method</Text>
      <Text style={styles.stepDescription}>
        A payment method is required to publish cleaning offers. You can set it
        up now or later from Settings.
      </Text>

      {/* Info Card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoCardEmoji}>💳</Text>
        <View style={styles.infoCardContent}>
          <Text style={styles.infoCardTitle}>Secure payments with Stripe</Text>
          <Text style={styles.infoCardDescription}>
            Your card details are stored securely by Stripe. We never see or
            store your full card number.
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.stepButtonContainer}>
        <Pressable
          style={[
            styles.primaryButton,
            isSubmitting && styles.primaryButtonDisabled,
          ]}
          onPress={onSetupPayment}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Set up payment method"
          accessibilityState={{ disabled: isSubmitting }}
        >
          <Text style={styles.primaryButtonText}>
            {isSubmitting ? 'Saving...' : 'Set up payment'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.skipButton}
          onPress={onSkip}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Skip payment setup for now"
          accessibilityState={{ disabled: isSubmitting }}
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function HostOnboardingScreen({
  onComplete,
  onSkip,
}: HostOnboardingScreenProps) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  // ─── State ─────────────────────────────────────────────────────────────────

  const [currentStep, setCurrentStep] = useState(STEP_NAME_CONFIRMATION);
  const [displayName, setDisplayName] = useState(user?.fullName ?? '');
  const [isBusiness, setIsBusiness] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Animations ────────────────────────────────────────────────────────────

  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);

  useEffect(() => {
    headerOpacity.value = withDelay(
      ENTRANCE_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    headerTranslateY.value = withDelay(
      ENTRANCE_DELAY_MS,
      withSpring(0, SPRING_CONFIG),
    );
  }, [headerOpacity, headerTranslateY]);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleNameContinue = useCallback(() => {
    setCurrentStep(STEP_PAYMENT_METHOD);
  }, []);

  const submitHostProfile = useCallback(
    async (paymentMethodAdded: boolean) => {
      setIsSubmitting(true);

      try {
        await apiClient.post(HOST_PROFILE_ENDPOINT, {
          displayName: displayName.trim(),
          isBusiness,
          businessName: isBusiness ? businessName.trim() : undefined,
          paymentMethodAdded,
        });

        if (onComplete) {
          onComplete();
        } else {
          router.replace('/host' as never);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Something went wrong. Please try again.';

        Alert.alert('Error', message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [displayName, isBusiness, businessName, onComplete, router],
  );

  const handleSetupPayment = useCallback(() => {
    // Placeholder: actual Stripe setup is in the stripe-escrow spec.
    // For now, mark payment as "intended" and complete onboarding.
    submitHostProfile(true);
  }, [submitHostProfile]);

  const handleSkipPayment = useCallback(() => {
    if (onSkip) {
      onSkip();
      return;
    }
    submitHostProfile(false);
  }, [onSkip, submitHostProfile]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with step indicator */}
      <Animated.View style={[styles.headerSection, headerAnimatedStyle]}>
        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />
        <Text style={styles.title}>Host setup</Text>
        <Text style={styles.subtitle}>
          Complete these steps to start publishing cleaning offers.
        </Text>
      </Animated.View>

      {/* Step Content */}
      <View style={styles.contentSection}>
        {currentStep === STEP_NAME_CONFIRMATION && (
          <NameConfirmationStep
            displayName={displayName}
            isBusiness={isBusiness}
            businessName={businessName}
            onDisplayNameChange={setDisplayName}
            onBusinessToggle={setIsBusiness}
            onBusinessNameChange={setBusinessName}
            onContinue={handleNameContinue}
          />
        )}

        {currentStep === STEP_PAYMENT_METHOD && (
          <PaymentMethodStep
            onSetupPayment={handleSetupPayment}
            onSkip={handleSkipPayment}
            isSubmitting={isSubmitting}
          />
        )}
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
  headerSection: {
    marginTop: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
    marginTop: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    lineHeight: 20,
  },
  contentSection: {
    flex: 1,
  },

  // ─── Step Indicator ──────────────────────────────────────────────────────

  stepIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
  },
  stepDotActive: {
    backgroundColor: COLORS.accent,
    width: 24,
    borderRadius: 4,
  },
  stepDotCompleted: {
    backgroundColor: COLORS.accent,
  },
  stepText: {
    fontSize: FONT_SIZE.stepIndicator,
    color: COLORS.textSecondary,
    marginLeft: SPACING.xs,
  },

  // ─── Step Content ────────────────────────────────────────────────────────

  stepContent: {
    flex: 1,
    paddingTop: SPACING.md,
  },
  stepTitle: {
    fontSize: FONT_SIZE.cardTitle,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  stepDescription: {
    fontSize: FONT_SIZE.cardDescription,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },

  // ─── Input Groups ───────────────────────────────────────────────────────

  inputGroup: {
    marginBottom: SPACING.md,
  },
  inputLabel: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    fontWeight: '500',
  },
  textInput: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONT_SIZE.input,
    color: COLORS.textPrimary,
  },

  // ─── Toggle Row ─────────────────────────────────────────────────────────

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  toggleLabel: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },

  // ─── Info Card ──────────────────────────────────────────────────────────

  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  infoCardEmoji: {
    fontSize: 32,
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  infoCardDescription: {
    fontSize: FONT_SIZE.cardDescription,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },

  // ─── Buttons ────────────────────────────────────────────────────────────

  stepButtonContainer: {
    marginTop: 'auto',
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  primaryButtonTextDisabled: {
    color: COLORS.background,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  skipButtonText: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
});

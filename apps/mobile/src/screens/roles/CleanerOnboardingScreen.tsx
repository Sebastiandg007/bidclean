/**
 * CleanerOnboardingScreen — Multi-step onboarding for Cleaner role.
 *
 * Step 1 (Required): KYC verification trigger — informational card explaining
 *         identity verification is needed. Actual KYC is in `kyc-verification` spec.
 * Step 2 (Required): Work zone setup — placeholder map with radius/coordinate config.
 *         Actual Mapbox integration comes later.
 * Step 3 (Required): Availability picker — day/time-slot selection stored as JSONB.
 * Step 4 (Optional): Specialties — multi-select chip list, skippable.
 *
 * On completion, calls POST /users/me/cleaner-profile then navigates
 * to the Cleaner main view (Radar tab).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
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

import type { CleanerOnboardingScreenProps } from './roles.types';
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
  chip: 14,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const ENTRANCE_DELAY_MS = 100;

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;
const STEP_KYC = 1;
const STEP_WORK_ZONE = 2;
const STEP_AVAILABILITY = 3;
const STEP_SPECIALTIES = 4;

const CLEANER_PROFILE_ENDPOINT = '/users/me/cleaner-profile';

const DEFAULT_RADIUS_KM = 5;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 50;

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const TIME_SLOTS = ['morning', 'afternoon', 'evening', 'full_day'] as const;

const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  morning: '🌅 Morning',
  afternoon: '☀️ Afternoon',
  evening: '🌙 Evening',
  full_day: '📅 Full day',
};

const SPECIALTY_OPTIONS = [
  'airbnb',
  'offices',
  'homes',
  'post_event',
  'deep_cleaning',
  'move_in_out',
] as const;

const SPECIALTY_LABELS: Record<Specialty, string> = {
  airbnb: '🏠 Airbnb',
  offices: '🏢 Offices',
  homes: '🏡 Homes',
  post_event: '🎉 Post-event',
  deep_cleaning: '🧹 Deep cleaning',
  move_in_out: '📦 Move in/out',
};

// ─── Types ───────────────────────────────────────────────────────────────────

type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
type TimeSlot = (typeof TIME_SLOTS)[number];
type Specialty = (typeof SPECIALTY_OPTIONS)[number];

interface DayAvailability {
  enabled: boolean;
  slots: TimeSlot[];
}

type AvailabilityMap = Record<DayOfWeek, DayAvailability>;

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

// ─── KYC Step ────────────────────────────────────────────────────────────────

interface KycStepProps {
  onContinue: () => void;
}

function KycStep({ onContinue }: KycStepProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.stepContent}
    >
      <Text style={styles.stepTitle}>Identity verification</Text>
      <Text style={styles.stepDescription}>
        To ensure safety for everyone, we require identity verification before
        you can accept cleaning offers.
      </Text>

      <View style={styles.infoCard}>
        <Text style={styles.infoCardEmoji}>🪪</Text>
        <View style={styles.infoCardContent}>
          <Text style={styles.infoCardTitle}>What you will need</Text>
          <Text style={styles.infoCardDescription}>
            A government-issued ID (passport, driver's license, or national ID)
            and a selfie for face matching. The process takes about 2 minutes.
          </Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoCardEmoji}>✅</Text>
        <View style={styles.infoCardContent}>
          <Text style={styles.infoCardTitle}>You can start working soon</Text>
          <Text style={styles.infoCardDescription}>
            Starting verification is required now, but you do not need approval
            to explore the app. You will be notified once verified.
          </Text>
        </View>
      </View>

      <View style={styles.stepButtonContainer}>
        <Pressable
          style={styles.primaryButton}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Start verification and continue"
        >
          <Text style={styles.primaryButtonText}>Start verification</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Work Zone Step ──────────────────────────────────────────────────────────

interface WorkZoneStepProps {
  radiusKm: number;
  onRadiusChange: (value: number) => void;
  onContinue: () => void;
}

function WorkZoneStep({ radiusKm, onRadiusChange, onContinue }: WorkZoneStepProps) {
  const handleRadiusInput = useCallback(
    (text: string) => {
      const parsed = parseInt(text, 10);
      if (!isNaN(parsed) && parsed >= MIN_RADIUS_KM && parsed <= MAX_RADIUS_KM) {
        onRadiusChange(parsed);
      } else if (text === '') {
        onRadiusChange(MIN_RADIUS_KM);
      }
    },
    [onRadiusChange],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.stepContent}
    >
      <Text style={styles.stepTitle}>Set your work zone</Text>
      <Text style={styles.stepDescription}>
        Define the area where you want to receive cleaning offers. You will only
        see offers within this radius.
      </Text>

      {/* Placeholder Map Visual */}
      <View
        style={styles.mapPlaceholder}
        accessibilityRole="image"
        accessibilityLabel={`Work zone radius of ${radiusKm} kilometers`}
      >
        <View style={styles.mapCircleOuter}>
          <View style={styles.mapCircleInner}>
            <Text style={styles.mapCircleText}>{radiusKm} km</Text>
          </View>
        </View>
        <Text style={styles.mapPlaceholderNote}>
          📍 Your location will be used as the center
        </Text>
      </View>

      {/* Radius Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>
          Radius ({MIN_RADIUS_KM}–{MAX_RADIUS_KM} km)
        </Text>
        <TextInput
          style={styles.textInput}
          value={String(radiusKm)}
          onChangeText={handleRadiusInput}
          keyboardType="numeric"
          placeholder={`${DEFAULT_RADIUS_KM}`}
          placeholderTextColor={COLORS.textSecondary}
          accessibilityLabel="Work zone radius in kilometers"
          accessibilityRole="text"
        />
      </View>

      <View style={styles.stepButtonContainer}>
        <Pressable
          style={styles.primaryButton}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue to availability setup"
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Availability Step ───────────────────────────────────────────────────────

interface AvailabilityStepProps {
  availability: AvailabilityMap;
  onToggleDay: (day: DayOfWeek) => void;
  onToggleSlot: (day: DayOfWeek, slot: TimeSlot) => void;
  onContinue: () => void;
}

function AvailabilityStep({
  availability,
  onToggleDay,
  onToggleSlot,
  onContinue,
}: AvailabilityStepProps) {
  const hasAtLeastOneDay = DAYS_OF_WEEK.some(
    (day) => availability[day].enabled && availability[day].slots.length > 0,
  );

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.stepContent}
    >
      <Text style={styles.stepTitle}>Set your availability</Text>
      <Text style={styles.stepDescription}>
        Choose which days and times you are available to work. You can change
        this anytime.
      </Text>

      <ScrollView
        style={styles.availabilityScroll}
        showsVerticalScrollIndicator={false}
      >
        {DAYS_OF_WEEK.map((day) => (
          <View key={day} style={styles.dayRow}>
            <Pressable
              style={[
                styles.dayChip,
                availability[day].enabled && styles.dayChipActive,
              ]}
              onPress={() => onToggleDay(day)}
              accessibilityRole="checkbox"
              accessibilityLabel={day}
              accessibilityState={{ checked: availability[day].enabled }}
            >
              <Text
                style={[
                  styles.dayChipText,
                  availability[day].enabled && styles.dayChipTextActive,
                ]}
              >
                {day.slice(0, 3)}
              </Text>
            </Pressable>

            {availability[day].enabled && (
              <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(150)}
                style={styles.slotsRow}
              >
                {TIME_SLOTS.map((slot) => {
                  const isSelected = availability[day].slots.includes(slot);
                  return (
                    <Pressable
                      key={slot}
                      style={[
                        styles.slotChip,
                        isSelected && styles.slotChipActive,
                      ]}
                      onPress={() => onToggleSlot(day, slot)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${TIME_SLOT_LABELS[slot]} on ${day}`}
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text
                        style={[
                          styles.slotChipText,
                          isSelected && styles.slotChipTextActive,
                        ]}
                      >
                        {TIME_SLOT_LABELS[slot]}
                      </Text>
                    </Pressable>
                  );
                })}
              </Animated.View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.stepButtonContainer}>
        <Pressable
          style={[
            styles.primaryButton,
            !hasAtLeastOneDay && styles.primaryButtonDisabled,
          ]}
          onPress={onContinue}
          disabled={!hasAtLeastOneDay}
          accessibilityRole="button"
          accessibilityLabel="Continue to specialties"
          accessibilityState={{ disabled: !hasAtLeastOneDay }}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !hasAtLeastOneDay && styles.primaryButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Specialties Step ────────────────────────────────────────────────────────

interface SpecialtiesStepProps {
  selectedSpecialties: Specialty[];
  onToggleSpecialty: (specialty: Specialty) => void;
  onComplete: () => void;
  onSkip: () => void;
  isSubmitting: boolean;
}

function SpecialtiesStep({
  selectedSpecialties,
  onToggleSpecialty,
  onComplete,
  onSkip,
  isSubmitting,
}: SpecialtiesStepProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.stepContent}
    >
      <Text style={styles.stepTitle}>Add your specialties</Text>
      <Text style={styles.stepDescription}>
        Select the types of cleaning you specialize in. This helps match you
        with the right offers. You can update this later.
      </Text>

      <View style={styles.specialtiesGrid}>
        {SPECIALTY_OPTIONS.map((specialty) => {
          const isSelected = selectedSpecialties.includes(specialty);
          return (
            <Pressable
              key={specialty}
              style={[
                styles.specialtyChip,
                isSelected && styles.specialtyChipActive,
              ]}
              onPress={() => onToggleSpecialty(specialty)}
              disabled={isSubmitting}
              accessibilityRole="checkbox"
              accessibilityLabel={SPECIALTY_LABELS[specialty]}
              accessibilityState={{ checked: isSelected, disabled: isSubmitting }}
            >
              <Text
                style={[
                  styles.specialtyChipText,
                  isSelected && styles.specialtyChipTextActive,
                ]}
              >
                {SPECIALTY_LABELS[specialty]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.stepButtonContainer}>
        <Pressable
          style={[
            styles.primaryButton,
            isSubmitting && styles.primaryButtonDisabled,
          ]}
          onPress={onComplete}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Complete onboarding with specialties"
          accessibilityState={{ disabled: isSubmitting }}
        >
          <Text style={styles.primaryButtonText}>
            {isSubmitting ? 'Saving...' : 'Complete setup'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.skipButton}
          onPress={onSkip}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Skip specialties for now"
          accessibilityState={{ disabled: isSubmitting }}
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Helper: Build Initial Availability ──────────────────────────────────────

function buildInitialAvailability(): AvailabilityMap {
  const map = {} as AvailabilityMap;
  for (const day of DAYS_OF_WEEK) {
    map[day] = { enabled: false, slots: [] };
  }
  return map;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CleanerOnboardingScreen({
  onComplete,
  onSkip,
}: CleanerOnboardingScreenProps) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  // ─── State ─────────────────────────────────────────────────────────────────

  const [currentStep, setCurrentStep] = useState(STEP_KYC);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [availability, setAvailability] = useState<AvailabilityMap>(
    buildInitialAvailability,
  );
  const [selectedSpecialties, setSelectedSpecialties] = useState<Specialty[]>(
    [],
  );
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

  const handleKycContinue = useCallback(() => {
    setCurrentStep(STEP_WORK_ZONE);
  }, []);

  const handleWorkZoneContinue = useCallback(() => {
    setCurrentStep(STEP_AVAILABILITY);
  }, []);

  const handleAvailabilityContinue = useCallback(() => {
    setCurrentStep(STEP_SPECIALTIES);
  }, []);

  const handleToggleDay = useCallback((day: DayOfWeek) => {
    setAvailability((prev) => ({
      ...prev,
      [day]: {
        enabled: !prev[day].enabled,
        slots: !prev[day].enabled ? prev[day].slots : [],
      },
    }));
  }, []);

  const handleToggleSlot = useCallback((day: DayOfWeek, slot: TimeSlot) => {
    setAvailability((prev) => {
      const current = prev[day].slots;
      const updated = current.includes(slot)
        ? current.filter((s) => s !== slot)
        : [...current, slot];

      return {
        ...prev,
        [day]: { ...prev[day], slots: updated },
      };
    });
  }, []);

  const handleToggleSpecialty = useCallback((specialty: Specialty) => {
    setSelectedSpecialties((prev) =>
      prev.includes(specialty)
        ? prev.filter((s) => s !== specialty)
        : [...prev, specialty],
    );
  }, []);

  const submitCleanerProfile = useCallback(
    async (specialties: Specialty[]) => {
      setIsSubmitting(true);

      try {
        const availabilityPayload = buildAvailabilityPayload(availability);

        await apiClient.post(CLEANER_PROFILE_ENDPOINT, {
          displayName: user?.fullName?.trim() ?? '',
          workZoneLat: 0,
          workZoneLng: 0,
          workZoneRadiusKm: radiusKm,
          availability: availabilityPayload,
          specialties,
        });

        if (onComplete) {
          onComplete();
        } else {
          router.replace('/cleaner' as never);
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
    [availability, radiusKm, user, onComplete, router],
  );

  const handleCompleteWithSpecialties = useCallback(() => {
    submitCleanerProfile(selectedSpecialties);
  }, [submitCleanerProfile, selectedSpecialties]);

  const handleSkipSpecialties = useCallback(() => {
    if (onSkip) {
      onSkip();
      return;
    }
    submitCleanerProfile([]);
  }, [onSkip, submitCleanerProfile]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with step indicator */}
      <Animated.View style={[styles.headerSection, headerAnimatedStyle]}>
        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />
        <Text style={styles.title}>Cleaner setup</Text>
        <Text style={styles.subtitle}>
          Complete these steps to start receiving cleaning offers nearby.
        </Text>
      </Animated.View>

      {/* Step Content */}
      <View style={styles.contentSection}>
        {currentStep === STEP_KYC && (
          <KycStep onContinue={handleKycContinue} />
        )}

        {currentStep === STEP_WORK_ZONE && (
          <WorkZoneStep
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
            onContinue={handleWorkZoneContinue}
          />
        )}

        {currentStep === STEP_AVAILABILITY && (
          <AvailabilityStep
            availability={availability}
            onToggleDay={handleToggleDay}
            onToggleSlot={handleToggleSlot}
            onContinue={handleAvailabilityContinue}
          />
        )}

        {currentStep === STEP_SPECIALTIES && (
          <SpecialtiesStep
            selectedSpecialties={selectedSpecialties}
            onToggleSpecialty={handleToggleSpecialty}
            onComplete={handleCompleteWithSpecialties}
            onSkip={handleSkipSpecialties}
            isSubmitting={isSubmitting}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert the AvailabilityMap into a JSONB-compatible payload for the API.
 */
function buildAvailabilityPayload(
  map: AvailabilityMap,
): Record<string, string[]> {
  const payload: Record<string, string[]> = {};

  for (const day of DAYS_OF_WEEK) {
    if (map[day].enabled && map[day].slots.length > 0) {
      payload[day.toLowerCase()] = [...map[day].slots];
    }
  }

  return payload;
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

  // ─── Info Card ──────────────────────────────────────────────────────────

  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    marginBottom: SPACING.md,
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

  // ─── Map Placeholder ───────────────────────────────────────────────────

  mapPlaceholder: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
    minHeight: 180,
  },
  mapCircleOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCircleInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: `${COLORS.accent}33`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCircleText: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.accent,
  },
  mapPlaceholderNote: {
    fontSize: FONT_SIZE.cardDescription,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },

  // ─── Availability ──────────────────────────────────────────────────────

  availabilityScroll: {
    flex: 1,
    marginBottom: SPACING.md,
  },
  dayRow: {
    marginBottom: SPACING.md,
  },
  dayChip: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
  },
  dayChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  dayChipText: {
    fontSize: FONT_SIZE.chip,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  dayChipTextActive: {
    color: COLORS.background,
  },
  slotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingLeft: SPACING.sm,
  },
  slotChip: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  slotChipActive: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.accent,
  },
  slotChipText: {
    fontSize: FONT_SIZE.chip,
    color: COLORS.textSecondary,
  },
  slotChipTextActive: {
    color: COLORS.accent,
  },

  // ─── Specialties ───────────────────────────────────────────────────────

  specialtiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  specialtyChip: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  specialtyChipActive: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.accent,
  },
  specialtyChipText: {
    fontSize: FONT_SIZE.chip,
    color: COLORS.textSecondary,
  },
  specialtyChipTextActive: {
    color: COLORS.accent,
    fontWeight: '600',
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

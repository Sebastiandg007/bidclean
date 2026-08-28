/**
 * CreateOfferScreen — Multi-step form for creating a new cleaning offer.
 *
 * Step 1: PropertySelector — Select an offer-ready property
 * Step 2: Service details — ServiceType + Duration + Date/Time + Price with live PriceBreakdown
 * Step 3: Review — Optional description + summary of all selections
 *
 * Features:
 * - Step indicator showing progress
 * - Per-step validation before allowing "Next"
 * - Back navigation between steps
 * - "Create Offer" on final step creates DRAFT and navigates to confirmation
 * - Dark mode UI (uses design tokens from offers.constants)
 * - SafeAreaView + KeyboardAvoidingView for proper layout
 * - Full accessibility support (roles, labels, states)
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';

import { PropertySelector } from './components/PropertySelector';
import { ServiceTypePicker } from './components/ServiceTypePicker';
import { DurationSelector } from './components/DurationSelector';
import { PriceBreakdown } from './components/PriceBreakdown';
import { useOffersStore } from './useOffers';
import {
  COLORS,
  FONT_SIZE,
  OFFER_MIN_DURATION_MINUTES,
  OFFER_MIN_LEAD_MINUTES,
  OFFER_ROUTES,
  SPACING,
} from './offers.constants';
import type { ServiceType } from './offers.types';

// ─── Constants (from environment via offers.constants pattern) ────────────────

const TOTAL_STEPS = 3;
const BPS_DIVISOR = 10000;
const STEP_INDICATOR_SIZE = 28;
const STEP_INDICATOR_ACTIVE_SIZE = 32;

/**
 * Host fee rate in basis points, sourced from environment.
 * 1000 bps = 10% default (matches backend OFFER_HOST_FEE_RATE).
 */
const HOST_FEE_RATE_BPS = Number(
  process.env.EXPO_PUBLIC_OFFER_HOST_FEE_RATE ?? '1000',
);

/** Default currency for new offers, from environment */
const DEFAULT_CURRENCY = process.env.EXPO_PUBLIC_DEFAULT_CURRENCY ?? 'USD';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CreateOfferScreenProps {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    goBack: () => void;
  };
}

interface FormState {
  propertyId: string;
  serviceType: ServiceType | null;
  durationMinutes: number;
  scheduledDate: Date;
  priceCents: number;
  description: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMinScheduledDate(): Date {
  const min = new Date();
  min.setMinutes(min.getMinutes() + OFFER_MIN_LEAD_MINUTES);
  return min;
}

function calculateHostFee(priceCents: number): number {
  return Math.trunc((priceCents * HOST_FEE_RATE_BPS) / BPS_DIVISOR);
}

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function formatDurationDisplay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  const { t } = useTranslation();

  return (
    <View
      style={styles.stepIndicatorContainer}
      accessibilityRole="progressbar"
      accessibilityLabel={t('offers.create.stepIndicator', {
        current: currentStep,
        total: totalSteps,
        defaultValue: `Step ${currentStep} of ${totalSteps}`,
      })}
      accessibilityValue={{ min: 1, max: totalSteps, now: currentStep }}
      testID="step-indicator"
    >
      {Array.from({ length: totalSteps }, (_, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;

        return (
          <View key={stepNumber} style={styles.stepRow}>
            <View
              style={[
                styles.stepDot,
                isActive && styles.stepDotActive,
                isCompleted && styles.stepDotCompleted,
              ]}
            >
              <Text
                style={[
                  styles.stepDotText,
                  (isActive || isCompleted) && styles.stepDotTextActive,
                ]}
              >
                {isCompleted ? '✓' : stepNumber}
              </Text>
            </View>
            {index < totalSteps - 1 && (
              <View
                style={[
                  styles.stepLine,
                  isCompleted && styles.stepLineCompleted,
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Summary Row Sub-Component ───────────────────────────────────────────────

interface SummaryRowProps {
  label: string;
  value: string;
  isAccent?: boolean;
}

function SummaryRow({ label, value, isAccent }: SummaryRowProps) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, isAccent && styles.summaryValueAccent]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CreateOfferScreen({ navigation }: CreateOfferScreenProps) {
  const { t } = useTranslation();
  const { createOffer, isCreating } = useOffersStore();

  const [currentStep, setCurrentStep] = useState(1);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [form, setForm] = useState<FormState>({
    propertyId: '',
    serviceType: null,
    durationMinutes: OFFER_MIN_DURATION_MINUTES,
    scheduledDate: getMinScheduledDate(),
    priceCents: 0,
    description: '',
  });

  const [priceInput, setPriceInput] = useState('');

  // ─── Derived Values ──────────────────────────────────────────────────────

  const hostFeeCents = useMemo(
    () => calculateHostFee(form.priceCents),
    [form.priceCents],
  );

  const hostTotalCents = useMemo(
    () => form.priceCents + hostFeeCents,
    [form.priceCents, hostFeeCents],
  );

  // ─── Validation ──────────────────────────────────────────────────────────

  const isStep1Valid = form.propertyId.length > 0;

  const isStep2Valid = useMemo(() => {
    if (!form.serviceType) return false;
    if (form.priceCents <= 0) return false;
    if (form.scheduledDate <= new Date()) return false;
    return true;
  }, [form.serviceType, form.priceCents, form.scheduledDate]);

  const isCurrentStepValid = useMemo(() => {
    switch (currentStep) {
      case 1:
        return isStep1Valid;
      case 2:
        return isStep2Valid;
      case 3:
        return true; // Step 3 always valid (description is optional)
      default:
        return false;
    }
  }, [currentStep, isStep1Valid, isStep2Valid]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handlePropertySelect = useCallback((propertyId: string) => {
    setForm((prev) => ({ ...prev, propertyId }));
  }, []);

  const handleServiceTypeSelect = useCallback((serviceType: ServiceType) => {
    setForm((prev) => ({ ...prev, serviceType }));
  }, []);

  const handleDurationChange = useCallback((minutes: number) => {
    setForm((prev) => ({ ...prev, durationMinutes: minutes }));
  }, []);

  const handlePriceChange = useCallback((text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    setPriceInput(cleaned);

    const amount = parseFloat(cleaned);
    if (!isNaN(amount) && amount >= 0) {
      setForm((prev) => ({ ...prev, priceCents: Math.round(amount * 100) }));
    } else {
      setForm((prev) => ({ ...prev, priceCents: 0 }));
    }
  }, []);

  const handleDateChange = useCallback(
    (_event: unknown, selectedDate?: Date) => {
      setShowDatePicker(false);
      if (selectedDate) {
        setForm((prev) => {
          const newDate = new Date(prev.scheduledDate);
          newDate.setFullYear(selectedDate.getFullYear());
          newDate.setMonth(selectedDate.getMonth());
          newDate.setDate(selectedDate.getDate());
          return { ...prev, scheduledDate: newDate };
        });
      }
    },
    [],
  );

  const handleTimeChange = useCallback(
    (_event: unknown, selectedTime?: Date) => {
      setShowTimePicker(false);
      if (selectedTime) {
        setForm((prev) => {
          const newDate = new Date(prev.scheduledDate);
          newDate.setHours(selectedTime.getHours());
          newDate.setMinutes(selectedTime.getMinutes());
          return { ...prev, scheduledDate: newDate };
        });
      }
    },
    [],
  );

  const handleDescriptionChange = useCallback((text: string) => {
    setForm((prev) => ({ ...prev, description: text }));
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS && isCurrentStepValid) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, isCurrentStepValid]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    } else {
      navigation.goBack();
    }
  }, [currentStep, navigation]);

  const handleCreateOffer = useCallback(async () => {
    if (!form.serviceType) return;

    const offerId = await createOffer({
      propertyId: form.propertyId,
      serviceType: form.serviceType,
      description: form.description || undefined,
      scheduledAt: form.scheduledDate.toISOString(),
      timezone: getUserTimezone(),
      estimatedDurationMinutes: form.durationMinutes,
      offeredPriceCents: form.priceCents,
      currency: DEFAULT_CURRENCY,
    });

    if (offerId) {
      navigation.navigate(OFFER_ROUTES.OfferConfirmation, { offerId });
    } else {
      Alert.alert(
        t('offers.create.error.title', { defaultValue: 'Error' }),
        t('offers.create.error.message', {
          defaultValue: 'Could not create offer. Please try again.',
        }),
      );
    }
  }, [form, createOffer, navigation, t]);

  // ─── Render Steps ────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <View style={styles.stepContent} testID="create-offer-step-1">
        <Text style={styles.stepTitle}>
          {t('offers.create.step1.title', { defaultValue: 'Select Property' })}
        </Text>
        <Text style={styles.stepSubtitle}>
          {t('offers.create.step1.subtitle', {
            defaultValue: 'Choose a property for your cleaning offer',
          })}
        </Text>
        <PropertySelector
          onSelect={handlePropertySelect}
          selectedPropertyId={form.propertyId || undefined}
        />
      </View>
    );
  }

  function renderStep2() {
    return (
      <View style={styles.stepContent} testID="create-offer-step-2">
        <Text style={styles.stepTitle}>
          {t('offers.create.step2.title', { defaultValue: 'Service Details' })}
        </Text>

        {/* Service Type */}
        <Text style={styles.sectionLabel}>
          {t('offers.create.step2.serviceType', { defaultValue: 'Service Type' })}
        </Text>
        <ServiceTypePicker
          selectedType={form.serviceType ?? undefined}
          onSelect={handleServiceTypeSelect}
        />

        {/* Duration */}
        <View style={styles.sectionSpacer} />
        <DurationSelector
          value={form.durationMinutes}
          onChange={handleDurationChange}
        />

        {/* Date & Time */}
        <View style={styles.sectionSpacer} />
        <Text style={styles.sectionLabel}>
          {t('offers.create.step2.dateTime', { defaultValue: 'Date & Time' })}
        </Text>

        <View style={styles.dateTimeRow}>
          <TouchableOpacity
            style={styles.dateTimeButton}
            onPress={() => setShowDatePicker(true)}
            accessibilityRole="button"
            accessibilityLabel={t('offers.create.step2.selectDate', {
              defaultValue: 'Select date',
            })}
            testID="date-picker-button"
          >
            <Text style={styles.dateTimeIcon}>{'📅'}</Text>
            <Text style={styles.dateTimeText}>
              {form.scheduledDate.toLocaleDateString()}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dateTimeButton}
            onPress={() => setShowTimePicker(true)}
            accessibilityRole="button"
            accessibilityLabel={t('offers.create.step2.selectTime', {
              defaultValue: 'Select time',
            })}
            testID="time-picker-button"
          >
            <Text style={styles.dateTimeIcon}>{'🕐'}</Text>
            <Text style={styles.dateTimeText}>
              {form.scheduledDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={form.scheduledDate}
            mode="date"
            minimumDate={getMinScheduledDate()}
            onChange={handleDateChange}
            testID="date-time-picker-date"
          />
        )}

        {showTimePicker && (
          <DateTimePicker
            value={form.scheduledDate}
            mode="time"
            onChange={handleTimeChange}
            testID="date-time-picker-time"
          />
        )}

        {/* Price */}
        <View style={styles.sectionSpacer} />
        <Text style={styles.sectionLabel}>
          {t('offers.create.step2.price', {
            defaultValue: `Offered Price (${DEFAULT_CURRENCY})`,
          })}
        </Text>
        <View style={styles.priceInputContainer}>
          <Text style={styles.currencySymbol}>{'$'}</Text>
          <TextInput
            style={styles.priceInput}
            value={priceInput}
            onChangeText={handlePriceChange}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={COLORS.disabled}
            accessibilityLabel={t('offers.create.step2.priceInput', {
              defaultValue: 'Enter price in dollars',
            })}
            testID="price-input"
          />
        </View>

        {/* Live Price Breakdown */}
        {form.priceCents > 0 && (
          <View style={styles.sectionSpacer}>
            <PriceBreakdown
              offeredPriceCents={form.priceCents}
              currency={DEFAULT_CURRENCY}
              hostServiceFeeCents={hostFeeCents}
              hostTotalCents={hostTotalCents}
              hostServiceFeeRateBps={HOST_FEE_RATE_BPS}
            />
          </View>
        )}
      </View>
    );
  }

  function renderStep3() {
    const centsDivisor = 100;

    return (
      <View style={styles.stepContent} testID="create-offer-step-3">
        <Text style={styles.stepTitle}>
          {t('offers.create.step3.title', { defaultValue: 'Review & Description' })}
        </Text>

        {/* Optional Description */}
        <Text style={styles.sectionLabel}>
          {t('offers.create.step3.description', {
            defaultValue: 'Description (optional)',
          })}
        </Text>
        <TextInput
          style={styles.descriptionInput}
          value={form.description}
          onChangeText={handleDescriptionChange}
          multiline
          numberOfLines={4}
          placeholder={t('offers.create.step3.descriptionPlaceholder', {
            defaultValue: 'Add any special instructions or notes...',
          })}
          placeholderTextColor={COLORS.disabled}
          textAlignVertical="top"
          accessibilityLabel={t('offers.create.step3.descriptionA11y', {
            defaultValue: 'Offer description text field',
          })}
          testID="description-input"
        />

        {/* Review Summary */}
        <View style={styles.sectionSpacer} />
        <Text style={styles.sectionLabel}>
          {t('offers.create.step3.summary', { defaultValue: 'Summary' })}
        </Text>

        <View style={styles.summaryCard}>
          <SummaryRow
            label={t('offers.create.step3.property', { defaultValue: 'Property' })}
            value={form.propertyId ? `ID: ${form.propertyId.substring(0, 8)}...` : '—'}
          />
          <SummaryRow
            label={t('offers.create.step3.serviceType', { defaultValue: 'Service' })}
            value={
              form.serviceType
                ? t(`offers.serviceType.${form.serviceType}`, { defaultValue: form.serviceType })
                : '—'
            }
          />
          <SummaryRow
            label={t('offers.create.step3.duration', { defaultValue: 'Duration' })}
            value={formatDurationDisplay(form.durationMinutes)}
          />
          <SummaryRow
            label={t('offers.create.step3.dateTime', { defaultValue: 'Date & Time' })}
            value={form.scheduledDate.toLocaleString([], {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          />
          <SummaryRow
            label={t('offers.create.step3.offeredPrice', { defaultValue: 'Offered Price' })}
            value={`$${(form.priceCents / centsDivisor).toFixed(2)}`}
          />
          <SummaryRow
            label={t('offers.create.step3.totalCost', { defaultValue: 'Total Cost' })}
            value={`$${(hostTotalCents / centsDivisor).toFixed(2)}`}
            isAccent
          />
        </View>
      </View>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} testID="create-offer-screen">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={t('offers.create.back', { defaultValue: 'Go back' })}
            testID="back-button"
          >
            <Text style={styles.backButtonText}>{'←'}</Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>
            {t('offers.create.headerTitle', { defaultValue: 'Create Offer' })}
          </Text>

          <View style={styles.headerSpacer} />
        </View>

        {/* Step Indicator */}
        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />

        {/* Step Content */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </ScrollView>

        {/* Footer Actions */}
        <View style={styles.footer}>
          {currentStep < TOTAL_STEPS ? (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                !isCurrentStepValid && styles.primaryButtonDisabled,
              ]}
              onPress={handleNext}
              disabled={!isCurrentStepValid}
              accessibilityRole="button"
              accessibilityLabel={t('offers.create.next', { defaultValue: 'Next step' })}
              accessibilityState={{ disabled: !isCurrentStepValid }}
              testID="next-button"
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  !isCurrentStepValid && styles.primaryButtonTextDisabled,
                ]}
              >
                {t('offers.create.next', { defaultValue: 'Next' })}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isCreating || !isCurrentStepValid) && styles.primaryButtonDisabled,
              ]}
              onPress={handleCreateOffer}
              disabled={isCreating || !isCurrentStepValid}
              accessibilityRole="button"
              accessibilityLabel={t('offers.create.submit', {
                defaultValue: 'Create Offer',
              })}
              accessibilityState={{ disabled: isCreating }}
              testID="create-offer-button"
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  isCreating && styles.primaryButtonTextDisabled,
                ]}
              >
                {isCreating
                  ? t('offers.create.creating', { defaultValue: 'Creating...' })
                  : t('offers.create.submit', { defaultValue: 'Create Offer' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  // ─── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 20,
    color: COLORS.textPrimary,
  },
  headerTitle: {
    flex: 1,
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  // ─── Step Indicator ────────────────────────────────────────────────────────
  stepIndicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: STEP_INDICATOR_SIZE,
    height: STEP_INDICATOR_SIZE,
    borderRadius: STEP_INDICATOR_SIZE / 2,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: {
    width: STEP_INDICATOR_ACTIVE_SIZE,
    height: STEP_INDICATOR_ACTIVE_SIZE,
    borderRadius: STEP_INDICATOR_ACTIVE_SIZE / 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSubtle,
  },
  stepDotCompleted: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  stepDotText: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  stepDotTextActive: {
    color: COLORS.textPrimary,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.xs,
  },
  stepLineCompleted: {
    backgroundColor: COLORS.accent,
  },
  // ─── Step Content ──────────────────────────────────────────────────────────
  stepContent: {
    flex: 1,
    paddingTop: SPACING.md,
  },
  stepTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  stepSubtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionSpacer: {
    marginTop: SPACING.lg,
  },
  // ─── Date/Time ─────────────────────────────────────────────────────────────
  dateTimeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  dateTimeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  dateTimeIcon: {
    fontSize: 18,
  },
  dateTimeText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  // ─── Price Input ───────────────────────────────────────────────────────────
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
  },
  currencySymbol: {
    fontSize: FONT_SIZE.large,
    fontWeight: '700',
    color: COLORS.accent,
    marginRight: SPACING.sm,
  },
  priceInput: {
    flex: 1,
    fontSize: FONT_SIZE.large,
    fontWeight: '600',
    color: COLORS.textPrimary,
    paddingVertical: SPACING.md,
  },
  // ─── Description ───────────────────────────────────────────────────────────
  descriptionInput: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
    minHeight: 100,
  },
  // ─── Summary Card ──────────────────────────────────────────────────────────
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  summaryLabel: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  summaryValue: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
    maxWidth: '55%',
    textAlign: 'right',
  },
  summaryValueAccent: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  // ─── Footer ────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  primaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    color: COLORS.background,
  },
  primaryButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
});

export default CreateOfferScreen;

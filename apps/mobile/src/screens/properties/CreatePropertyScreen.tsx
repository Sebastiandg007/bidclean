/**
 * CreatePropertyScreen
 *
 * Multi-step form for creating a new property:
 * Step 1: Basic info + type selection
 * Step 2: Address + map (geocoding with manual pin fallback)
 * Step 3: Photos + details (checklist, requirements)
 *
 * Saves with Idempotency-Key on final step via the store's createProperty().
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import {
  COLORS,
  FONT_SIZE,
  PROPERTY_DESCRIPTION_MAX_LENGTH,
  PROPERTY_MAX_BATHROOMS,
  PROPERTY_MAX_BEDROOMS,
  PROPERTY_MAX_SQM,
  PROPERTY_NAME_MAX_LENGTH,
  SPACING,
  SPRING_CONFIG,
} from './properties.constants';
import type {
  Coordinates,
  CreatePropertyPayload,
  LocationSource,
  PropertyAddress,
  PropertyType,
  SupportedCountry,
} from './properties.types';
import { useProperties } from './useProperties';
import { PropertyTypeSelector } from './components/PropertyTypeSelector';
import { AddressInput } from './components/AddressInput';
import { PropertyMap } from './components/PropertyMap';
import { PhotoUploader } from './components/PhotoUploader';
import { ChecklistEditor } from './components/ChecklistEditor';
import { RequirementsChips } from './components/RequirementsChips';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Total steps in the creation wizard */
const TOTAL_STEPS = 3;

/** Delay before animating step transitions (ms) */
const STEP_TRANSITION_DELAY_MS = 100;

/** Size of step indicator dots (px) */
const STEP_DOT_SIZE = 32;

// ─── Form State ──────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  type: PropertyType | null;
  description: string;
  squareMeters: string;
  bedrooms: string;
  bathrooms: string;
  address: Partial<PropertyAddress>;
  coordinates: Coordinates | null;
  locationSource: LocationSource;
  checklistItems: string[];
  specialRequirements: string[];
  accessInstructions: string;
  floorNumber: string;
  hasParking: boolean;
  hasElevator: boolean;
}

type FormAction =
  | { type: 'SET_NAME'; payload: string }
  | { type: 'SET_TYPE'; payload: PropertyType }
  | { type: 'SET_DESCRIPTION'; payload: string }
  | { type: 'SET_SQUARE_METERS'; payload: string }
  | { type: 'SET_BEDROOMS'; payload: string }
  | { type: 'SET_BATHROOMS'; payload: string }
  | { type: 'SET_ADDRESS'; payload: Partial<PropertyAddress> }
  | { type: 'SET_COORDINATES'; payload: Coordinates }
  | { type: 'SET_LOCATION_SOURCE'; payload: LocationSource }
  | { type: 'SET_CHECKLIST'; payload: string[] }
  | { type: 'SET_REQUIREMENTS'; payload: string[] }
  | { type: 'SET_ACCESS_INSTRUCTIONS'; payload: string }
  | { type: 'SET_FLOOR_NUMBER'; payload: string }
  | { type: 'SET_HAS_PARKING'; payload: boolean }
  | { type: 'SET_HAS_ELEVATOR'; payload: boolean };

const initialFormState: FormState = {
  name: '',
  type: null,
  description: '',
  squareMeters: '',
  bedrooms: '0',
  bathrooms: '1',
  address: {},
  coordinates: null,
  locationSource: 'GEOCODED',
  checklistItems: [],
  specialRequirements: [],
  accessInstructions: '',
  floorNumber: '',
  hasParking: false,
  hasElevator: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME':
      return { ...state, name: action.payload };
    case 'SET_TYPE':
      return { ...state, type: action.payload };
    case 'SET_DESCRIPTION':
      return { ...state, description: action.payload };
    case 'SET_SQUARE_METERS':
      return { ...state, squareMeters: action.payload };
    case 'SET_BEDROOMS':
      return { ...state, bedrooms: action.payload };
    case 'SET_BATHROOMS':
      return { ...state, bathrooms: action.payload };
    case 'SET_ADDRESS':
      return { ...state, address: action.payload };
    case 'SET_COORDINATES':
      return { ...state, coordinates: action.payload };
    case 'SET_LOCATION_SOURCE':
      return { ...state, locationSource: action.payload };
    case 'SET_CHECKLIST':
      return { ...state, checklistItems: action.payload };
    case 'SET_REQUIREMENTS':
      return { ...state, specialRequirements: action.payload };
    case 'SET_ACCESS_INSTRUCTIONS':
      return { ...state, accessInstructions: action.payload };
    case 'SET_FLOOR_NUMBER':
      return { ...state, floorNumber: action.payload };
    case 'SET_HAS_PARKING':
      return { ...state, hasParking: action.payload };
    case 'SET_HAS_ELEVATOR':
      return { ...state, hasElevator: action.payload };
    default:
      return state;
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

interface ValidationErrors {
  name?: string;
  type?: string;
  squareMeters?: string;
  bedrooms?: string;
  bathrooms?: string;
  street?: string;
  city?: string;
  country?: string;
  coordinates?: string;
}

function validateStep1(state: FormState): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!state.name.trim()) {
    errors.name = 'properties.create.error.name_required';
  } else if (state.name.length > PROPERTY_NAME_MAX_LENGTH) {
    errors.name = 'properties.create.error.name_too_long';
  }
  if (!state.type) {
    errors.type = 'properties.create.error.type_required';
  }
  const sqm = Number(state.squareMeters);
  if (!state.squareMeters || sqm <= 0) {
    errors.squareMeters = 'properties.create.error.sqm_invalid';
  } else if (sqm > PROPERTY_MAX_SQM) {
    errors.squareMeters = 'properties.create.error.sqm_too_large';
  }
  const bedrooms = Number(state.bedrooms);
  if (isNaN(bedrooms) || bedrooms < 0 || bedrooms > PROPERTY_MAX_BEDROOMS) {
    errors.bedrooms = 'properties.create.error.bedrooms_invalid';
  }
  const bathrooms = Number(state.bathrooms);
  if (isNaN(bathrooms) || bathrooms < 1 || bathrooms > PROPERTY_MAX_BATHROOMS) {
    errors.bathrooms = 'properties.create.error.bathrooms_invalid';
  }
  return errors;
}

function validateStep2(state: FormState): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!state.address.street?.trim()) {
    errors.street = 'properties.create.error.street_required';
  }
  if (!state.address.city?.trim()) {
    errors.city = 'properties.create.error.city_required';
  }
  if (!state.address.country) {
    errors.country = 'properties.create.error.country_required';
  }
  if (!state.coordinates) {
    errors.coordinates = 'properties.create.error.location_required';
  }
  return errors;
}

function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface CreatePropertyScreenProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreatePropertyScreen({
  onSuccess,
  onCancel,
}: CreatePropertyScreenProps) {
  const { t } = useTranslation();
  const { createProperty, geocode, reverseGeocode, isMutating, error, clearError } =
    useProperties();

  const [currentStep, setCurrentStep] = useState(1);
  const [form, dispatch] = useReducer(formReducer, initialFormState);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);

  // ─── Animations ────────────────────────────────────────────────────────

  const stepOpacity = useSharedValue(1);

  useEffect(() => {
    stepOpacity.value = 0;
    const timer = setTimeout(() => {
      stepOpacity.value = withSpring(1, SPRING_CONFIG);
    }, STEP_TRANSITION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentStep, stepOpacity]);

  const animatedStepStyle = useAnimatedStyle(() => ({
    opacity: stepOpacity.value,
  }));

  // ─── Navigation ────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setValidationErrors({});
    if (currentStep === 1) {
      const errors = validateStep1(form);
      if (hasErrors(errors)) {
        setValidationErrors(errors);
        return;
      }
    } else if (currentStep === 2) {
      const errors = validateStep2(form);
      if (hasErrors(errors)) {
        setValidationErrors(errors);
        return;
      }
    }
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [currentStep, form]);

  const goBack = useCallback(() => {
    setValidationErrors({});
    if (currentStep === 1) {
      onCancel?.();
    } else {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep, onCancel]);

  // ─── Geocoding ─────────────────────────────────────────────────────────

  const handleGeocode = useCallback(async () => {
    const { street, city, country } = form.address;
    if (!street || !city || !country) return;

    setIsGeocoding(true);
    setGeocodingError(null);
    clearError();

    try {
      const query = `${street}, ${city}`;
      const result = await geocode({ address: query, country });
      if (result) {
        dispatch({
          type: 'SET_COORDINATES',
          payload: { latitude: result.latitude, longitude: result.longitude },
        });
        dispatch({ type: 'SET_LOCATION_SOURCE', payload: 'GEOCODED' });
        setGeocodingError(null);
      } else {
        setGeocodingError('properties.create.geocoding_failed_manual');
      }
    } catch {
      setGeocodingError('properties.create.geocoding_failed_manual');
    } finally {
      setIsGeocoding(false);
    }
  }, [form.address, geocode, clearError]);

  const handleMapLocationChange = useCallback(
    async (coords: Coordinates) => {
      dispatch({ type: 'SET_COORDINATES', payload: coords });
      dispatch({ type: 'SET_LOCATION_SOURCE', payload: 'MANUAL' });

      try {
        const result = await reverseGeocode({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        if (result) {
          dispatch({
            type: 'SET_ADDRESS',
            payload: {
              ...form.address,
              street: result.street ?? form.address.street,
              city: result.city ?? form.address.city,
              state: result.state,
              postalCode: result.postalCode,
              country: (result.country as SupportedCountry) ?? form.address.country,
            },
          });
        }
      } catch {
        // Reverse geocoding failure is non-blocking
      }
    },
    [reverseGeocode, form.address],
  );

  // ─── Submit ────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!form.type || !form.coordinates || !form.address.country) return;

    clearError();
    const payload: CreatePropertyPayload = {
      name: form.name.trim(),
      type: form.type,
      address: {
        street: form.address.street ?? '',
        city: form.address.city ?? '',
        state: form.address.state ?? null,
        postalCode: form.address.postalCode ?? null,
        country: form.address.country,
      },
      location: form.coordinates,
      locationSource: form.locationSource,
      squareMeters: Number(form.squareMeters),
      bedrooms: Number(form.bedrooms),
      bathrooms: Number(form.bathrooms),
    };

    if (form.description.trim()) {
      payload.description = form.description.trim();
    }
    if (form.floorNumber.trim()) {
      payload.floorNumber = Number(form.floorNumber);
    }
    if (form.hasParking) payload.hasParking = true;
    if (form.hasElevator) payload.hasElevator = true;
    if (form.checklistItems.length > 0) {
      payload.checklistItems = form.checklistItems;
    }
    if (form.specialRequirements.length > 0) {
      payload.specialRequirements = form.specialRequirements;
    }
    if (form.accessInstructions.trim()) {
      payload.accessInstructions = form.accessInstructions.trim();
    }

    try {
      const result = await createProperty(payload);
      if (result) {
        onSuccess?.();
      }
    } catch {
      // Error is shown via store error state
    }
  }, [form, createProperty, clearError, onSuccess]);

  // ─── Computed ──────────────────────────────────────────────────────────

  const isLastStep = currentStep === TOTAL_STEPS;
  const canSubmit = useMemo(() => {
    if (isMutating) return false;
    if (!form.type || !form.coordinates) return false;
    return true;
  }, [isMutating, form.type, form.coordinates]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} testID="create-property-screen">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t('properties.create.back', { defaultValue: 'Go back' })}
            testID="create-property-back-btn"
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>
              {currentStep === 1
                ? t('properties.create.cancel', { defaultValue: 'Cancel' })
                : t('properties.create.back_label', { defaultValue: 'Back' })}
            </Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {t('properties.create.title', { defaultValue: 'New Property' })}
          </Text>
          <View style={styles.headerButton} />
        </View>

        {/* Step Indicator */}
        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />

        {/* Step Content */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={animatedStepStyle}>
            {currentStep === 1 && (
              <Step1BasicInfo
                form={form}
                dispatch={dispatch}
                errors={validationErrors}
              />
            )}
            {currentStep === 2 && (
              <Step2Address
                form={form}
                dispatch={dispatch}
                errors={validationErrors}
                isGeocoding={isGeocoding}
                geocodingError={geocodingError}
                onGeocode={handleGeocode}
                onMapLocationChange={handleMapLocationChange}
              />
            )}
            {currentStep === 3 && (
              <Step3Details form={form} dispatch={dispatch} />
            )}
          </Animated.View>

          {/* Error from store */}
          {error && (
            <Text style={styles.errorText} accessibilityRole="alert" testID="create-property-error">
              {t(error, { defaultValue: error })}
            </Text>
          )}
        </ScrollView>

        {/* Footer Actions */}
        <View style={styles.footer}>
          {isLastStep ? (
            <Pressable
              style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel={t('properties.create.submit', { defaultValue: 'Create Property' })}
              accessibilityState={{ disabled: !canSubmit }}
              testID="create-property-submit-btn"
            >
              {isMutating ? (
                <ActivityIndicator color={COLORS.background} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {t('properties.create.submit', { defaultValue: 'Create Property' })}
                </Text>
              )}
            </Pressable>
          ) : (
            <Pressable
              style={styles.primaryButton}
              onPress={goNext}
              accessibilityRole="button"
              accessibilityLabel={t('properties.create.next', { defaultValue: 'Next' })}
              testID="create-property-next-btn"
            >
              <Text style={styles.primaryButtonText}>
                {t('properties.create.next', { defaultValue: 'Next' })}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
      style={styles.stepIndicator}
      accessibilityRole="progressbar"
      accessibilityLabel={t('properties.create.step_indicator', {
        current: currentStep,
        total: totalSteps,
        defaultValue: `Step ${currentStep} of ${totalSteps}`,
      })}
      testID="step-indicator"
    >
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        return (
          <View
            key={stepNum}
            style={[
              styles.stepDot,
              isCompleted && styles.stepDotCompleted,
              isCurrent && styles.stepDotCurrent,
            ]}
          >
            <Text
              style={[
                styles.stepDotText,
                (isCompleted || isCurrent) && styles.stepDotTextActive,
              ]}
            >
              {stepNum}
            </Text>
          </View>
        );
      })}
      <View style={styles.stepLine} />
    </View>
  );
}

// ─── Step 1: Basic Info ──────────────────────────────────────────────────────

interface Step1Props {
  form: FormState;
  dispatch: React.Dispatch<FormAction>;
  errors: ValidationErrors;
}

function Step1BasicInfo({ form, dispatch, errors }: Step1Props) {
  const { t } = useTranslation();

  return (
    <View testID="step-1-basic-info">
      {/* Property Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.name_label', { defaultValue: 'Property Name' })} *
        </Text>
        <TextInput
          style={[styles.textInput, errors.name && styles.textInputError]}
          value={form.name}
          onChangeText={(v) => dispatch({ type: 'SET_NAME', payload: v })}
          placeholder={t('properties.create.name_placeholder', { defaultValue: 'e.g. My Apartment' })}
          placeholderTextColor={COLORS.textSecondary}
          maxLength={PROPERTY_NAME_MAX_LENGTH}
          accessibilityLabel={t('properties.create.name_label', { defaultValue: 'Property Name' })}
          testID="input-property-name"
        />
        {errors.name && (
          <Text style={styles.fieldError}>{t(errors.name, { defaultValue: errors.name })}</Text>
        )}
      </View>

      {/* Property Type */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.type_label', { defaultValue: 'Property Type' })} *
        </Text>
        <PropertyTypeSelector
          selected={form.type ?? undefined}
          onChange={(type) => dispatch({ type: 'SET_TYPE', payload: type })}
        />
        {errors.type && (
          <Text style={styles.fieldError}>{t(errors.type, { defaultValue: errors.type })}</Text>
        )}
      </View>

      {/* Description */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.description_label', { defaultValue: 'Description (optional)' })}
        </Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          value={form.description}
          onChangeText={(v) => dispatch({ type: 'SET_DESCRIPTION', payload: v })}
          placeholder={t('properties.create.description_placeholder', { defaultValue: 'Describe your property...' })}
          placeholderTextColor={COLORS.textSecondary}
          maxLength={PROPERTY_DESCRIPTION_MAX_LENGTH}
          multiline
          numberOfLines={3}
          accessibilityLabel={t('properties.create.description_label', { defaultValue: 'Description' })}
          testID="input-property-description"
        />
      </View>

      {/* Square Meters */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.sqm_label', { defaultValue: 'Square Meters' })} *
        </Text>
        <TextInput
          style={[styles.textInput, errors.squareMeters && styles.textInputError]}
          value={form.squareMeters}
          onChangeText={(v) => dispatch({ type: 'SET_SQUARE_METERS', payload: v.replace(/[^0-9.]/g, '') })}
          placeholder="0"
          placeholderTextColor={COLORS.textSecondary}
          keyboardType="numeric"
          accessibilityLabel={t('properties.create.sqm_label', { defaultValue: 'Square Meters' })}
          testID="input-square-meters"
        />
        {errors.squareMeters && (
          <Text style={styles.fieldError}>{t(errors.squareMeters, { defaultValue: errors.squareMeters })}</Text>
        )}
      </View>

      {/* Bedrooms + Bathrooms Row */}
      <View style={styles.rowFields}>
        <View style={[styles.fieldGroup, styles.halfField]}>
          <Text style={styles.fieldLabel}>
            {t('properties.create.bedrooms_label', { defaultValue: 'Bedrooms' })}
          </Text>
          <TextInput
            style={[styles.textInput, errors.bedrooms && styles.textInputError]}
            value={form.bedrooms}
            onChangeText={(v) => dispatch({ type: 'SET_BEDROOMS', payload: v.replace(/[^0-9]/g, '') })}
            placeholder="0"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="numeric"
            accessibilityLabel={t('properties.create.bedrooms_label', { defaultValue: 'Bedrooms' })}
            testID="input-bedrooms"
          />
          {errors.bedrooms && (
            <Text style={styles.fieldError}>{t(errors.bedrooms, { defaultValue: errors.bedrooms })}</Text>
          )}
        </View>
        <View style={[styles.fieldGroup, styles.halfField]}>
          <Text style={styles.fieldLabel}>
            {t('properties.create.bathrooms_label', { defaultValue: 'Bathrooms' })} *
          </Text>
          <TextInput
            style={[styles.textInput, errors.bathrooms && styles.textInputError]}
            value={form.bathrooms}
            onChangeText={(v) => dispatch({ type: 'SET_BATHROOMS', payload: v.replace(/[^0-9]/g, '') })}
            placeholder="1"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="numeric"
            accessibilityLabel={t('properties.create.bathrooms_label', { defaultValue: 'Bathrooms' })}
            testID="input-bathrooms"
          />
          {errors.bathrooms && (
            <Text style={styles.fieldError}>{t(errors.bathrooms, { defaultValue: errors.bathrooms })}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Step 2: Address + Map ───────────────────────────────────────────────────

interface Step2Props {
  form: FormState;
  dispatch: React.Dispatch<FormAction>;
  errors: ValidationErrors;
  isGeocoding: boolean;
  geocodingError: string | null;
  onGeocode: () => void;
  onMapLocationChange: (coords: Coordinates) => void;
}

function Step2Address({
  form,
  dispatch,
  errors,
  isGeocoding,
  geocodingError,
  onGeocode,
  onMapLocationChange,
}: Step2Props) {
  const { t } = useTranslation();

  return (
    <View testID="step-2-address">
      {/* Address Input */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.address_label', { defaultValue: 'Address' })} *
        </Text>
        <AddressInput
          value={form.address}
          onChange={(addr) => dispatch({ type: 'SET_ADDRESS', payload: addr })}
          onGeocode={onGeocode}
          isGeocoding={isGeocoding}
          geocodingError={
            geocodingError
              ? t(geocodingError, { defaultValue: 'Could not find address. Place pin manually on the map.' })
              : null
          }
        />
        {errors.street && (
          <Text style={styles.fieldError}>{t(errors.street, { defaultValue: errors.street })}</Text>
        )}
        {errors.city && (
          <Text style={styles.fieldError}>{t(errors.city, { defaultValue: errors.city })}</Text>
        )}
        {errors.country && (
          <Text style={styles.fieldError}>{t(errors.country, { defaultValue: errors.country })}</Text>
        )}
      </View>

      {/* Map */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.map_label', { defaultValue: 'Location on Map' })}
        </Text>
        <PropertyMap
          coordinates={form.coordinates ?? undefined}
          onLocationChange={onMapLocationChange}
          editable
        />
        {errors.coordinates && (
          <Text style={styles.fieldError}>
            {t(errors.coordinates, { defaultValue: 'Please set a location on the map' })}
          </Text>
        )}
        {geocodingError && (
          <Text style={styles.hintText}>
            {t('properties.create.pin_hint', { defaultValue: 'Tap the map to place the pin manually.' })}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Step 3: Photos + Details ────────────────────────────────────────────────

interface Step3Props {
  form: FormState;
  dispatch: React.Dispatch<FormAction>;
}

function Step3Details({ form, dispatch }: Step3Props) {
  const { t } = useTranslation();

  return (
    <View testID="step-3-details">
      {/* Photos placeholder */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.photos_label', { defaultValue: 'Photos' })}
        </Text>
        <View style={styles.photoPlaceholder}>
          <PhotoUploader photos={[]} />
          <Text style={styles.photoNote}>
            {t('properties.create.photos_note', {
              defaultValue: 'Photos can be added after the property is created.',
            })}
          </Text>
        </View>
      </View>

      {/* Checklist */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.checklist_label', { defaultValue: 'Cleaning Checklist' })}
        </Text>
        <ChecklistEditor
          items={form.checklistItems}
          onChange={(items) => dispatch({ type: 'SET_CHECKLIST', payload: items })}
        />
      </View>

      {/* Requirements */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.requirements_label', { defaultValue: 'Special Requirements' })}
        </Text>
        <RequirementsChips
          selected={form.specialRequirements}
          onChange={(reqs) => dispatch({ type: 'SET_REQUIREMENTS', payload: reqs })}
        />
      </View>

      {/* Access Instructions */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.access_instructions_label', { defaultValue: 'Access Instructions (optional)' })}
        </Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          value={form.accessInstructions}
          onChangeText={(v) => dispatch({ type: 'SET_ACCESS_INSTRUCTIONS', payload: v })}
          placeholder={t('properties.create.access_instructions_placeholder', { defaultValue: 'How to access the property...' })}
          placeholderTextColor={COLORS.textSecondary}
          multiline
          numberOfLines={3}
          accessibilityLabel={t('properties.create.access_instructions_label', { defaultValue: 'Access Instructions' })}
          testID="input-access-instructions"
        />
      </View>

      {/* Floor Number */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.create.floor_label', { defaultValue: 'Floor Number (optional)' })}
        </Text>
        <TextInput
          style={styles.textInput}
          value={form.floorNumber}
          onChangeText={(v) => dispatch({ type: 'SET_FLOOR_NUMBER', payload: v.replace(/[^0-9]/g, '') })}
          placeholder="0"
          placeholderTextColor={COLORS.textSecondary}
          keyboardType="numeric"
          accessibilityLabel={t('properties.create.floor_label', { defaultValue: 'Floor Number' })}
          testID="input-floor-number"
        />
      </View>

      {/* Parking Toggle */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>
          {t('properties.create.has_parking', { defaultValue: 'Has Parking' })}
        </Text>
        <Switch
          value={form.hasParking}
          onValueChange={(v) => dispatch({ type: 'SET_HAS_PARKING', payload: v })}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          accessibilityRole="switch"
          accessibilityLabel={t('properties.create.has_parking', { defaultValue: 'Has Parking' })}
          testID="switch-has-parking"
        />
      </View>

      {/* Elevator Toggle */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>
          {t('properties.create.has_elevator', { defaultValue: 'Has Elevator' })}
        </Text>
        <Switch
          value={form.hasElevator}
          onValueChange={(v) => dispatch({ type: 'SET_HAS_ELEVATOR', payload: v })}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          accessibilityRole="switch"
          accessibilityLabel={t('properties.create.has_elevator', { defaultValue: 'Has Elevator' })}
          testID="switch-has-elevator"
        />
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  headerTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  headerButton: {
    width: 60,
  },
  headerButtonText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingVertical: SPACING.md,
    position: 'relative',
  },
  stepDot: {
    width: STEP_DOT_SIZE,
    height: STEP_DOT_SIZE,
    borderRadius: STEP_DOT_SIZE / 2,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  stepDotCompleted: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  stepDotCurrent: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.card,
  },
  stepDotText: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  stepDotTextActive: {
    color: COLORS.background,
  },
  stepLine: {
    position: 'absolute',
    left: '25%',
    right: '25%',
    height: 2,
    backgroundColor: COLORS.border,
    zIndex: 0,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  fieldGroup: {
    marginBottom: SPACING.lg,
  },
  fieldLabel: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textInputError: {
    borderColor: COLORS.error,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  fieldError: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
  rowFields: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  halfField: {
    flex: 1,
  },
  hintText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.accent,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
  photoPlaceholder: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    padding: SPACING.md,
  },
  photoNote: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    marginBottom: SPACING.md,
  },
  switchLabel: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textPrimary,
  },
  errorText: {
    fontSize: FONT_SIZE.label,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  footer: {
    paddingHorizontal: SPACING.md,
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
  primaryButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

export default CreatePropertyScreen;

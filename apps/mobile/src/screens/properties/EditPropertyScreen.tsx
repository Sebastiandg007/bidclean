/**
 * EditPropertyScreen
 *
 * Multi-step form for editing an existing property:
 * Step 1: Basic info + type selection (pre-populated)
 * Step 2: Address + map (geocoding with manual pin fallback)
 * Step 3: Details (checklist, requirements) — photos are read-only here
 *
 * Saves via PATCH endpoint with only changed fields.
 * Updates location_source on address re-geocoding or pin move.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  LocationSource,
  Property,
  PropertyAddress,
  PropertyType,
  SupportedCountry,
  UpdatePropertyPayload,
} from './properties.types';
import { useProperties } from './useProperties';
import { PropertyTypeSelector } from './components/PropertyTypeSelector';
import { AddressInput } from './components/AddressInput';
import { PropertyMap } from './components/PropertyMap';
import { ChecklistEditor } from './components/ChecklistEditor';
import { RequirementsChips } from './components/RequirementsChips';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Total steps in the edit wizard */
const TOTAL_STEPS = 3;

/** Delay before animating step transitions (ms) */
const STEP_TRANSITION_DELAY_MS = 100;

/** Size of step indicator dots (px) */
const STEP_DOT_SIZE = 32;

/** Border radius for primary button */
const BUTTON_BORDER_RADIUS = 12;

/** Photo thumbnail dimension (px) */
const PHOTO_THUMBNAIL_SIZE = 80;

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
  | { type: 'SET_HAS_ELEVATOR'; payload: boolean }
  | { type: 'INIT_FROM_PROPERTY'; payload: FormState };

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
    case 'INIT_FROM_PROPERTY':
      return action.payload;
    default:
      return state;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build initial form state from an existing Property entity */
function buildFormStateFromProperty(property: Property): FormState {
  return {
    name: property.name,
    type: property.type,
    description: property.description ?? '',
    squareMeters: String(property.squareMeters),
    bedrooms: String(property.bedrooms),
    bathrooms: String(property.bathrooms),
    address: {
      street: property.address.street,
      city: property.address.city,
      state: property.address.state ?? undefined,
      postalCode: property.address.postalCode ?? undefined,
      country: property.address.country,
    },
    coordinates: property.location,
    locationSource: property.locationSource,
    checklistItems: [...property.checklistItems],
    specialRequirements: [...property.specialRequirements],
    accessInstructions: property.accessInstructions ?? '',
    floorNumber: property.floorNumber != null ? String(property.floorNumber) : '',
    hasParking: property.hasParking,
    hasElevator: property.hasElevator,
  };
}

/** Compute the diff payload — only fields that changed from original */
function computeChangedFields(
  original: FormState,
  current: FormState,
): UpdatePropertyPayload {
  const payload: UpdatePropertyPayload = {};

  if (current.name.trim() !== original.name.trim()) {
    payload.name = current.name.trim();
  }
  if (current.type !== original.type && current.type) {
    payload.type = current.type;
  }
  if (current.description.trim() !== original.description.trim()) {
    payload.description = current.description.trim() || null;
  }
  if (current.squareMeters !== original.squareMeters) {
    payload.squareMeters = Number(current.squareMeters);
  }
  if (current.bedrooms !== original.bedrooms) {
    payload.bedrooms = Number(current.bedrooms);
  }
  if (current.bathrooms !== original.bathrooms) {
    payload.bathrooms = Number(current.bathrooms);
  }
  if (JSON.stringify(current.address) !== JSON.stringify(original.address)) {
    payload.address = {
      street: current.address.street ?? '',
      city: current.address.city ?? '',
      state: current.address.state ?? null,
      postalCode: current.address.postalCode ?? null,
      country: current.address.country as SupportedCountry,
    };
  }
  if (JSON.stringify(current.coordinates) !== JSON.stringify(original.coordinates)) {
    payload.location = current.coordinates!;
  }
  if (current.locationSource !== original.locationSource) {
    payload.locationSource = current.locationSource;
  }
  if (current.floorNumber !== original.floorNumber) {
    payload.floorNumber = current.floorNumber ? Number(current.floorNumber) : null;
  }
  if (current.hasParking !== original.hasParking) {
    payload.hasParking = current.hasParking;
  }
  if (current.hasElevator !== original.hasElevator) {
    payload.hasElevator = current.hasElevator;
  }
  if (JSON.stringify(current.checklistItems) !== JSON.stringify(original.checklistItems)) {
    payload.checklistItems = current.checklistItems;
  }
  if (JSON.stringify(current.specialRequirements) !== JSON.stringify(original.specialRequirements)) {
    payload.specialRequirements = current.specialRequirements;
  }
  if (current.accessInstructions.trim() !== original.accessInstructions.trim()) {
    payload.accessInstructions = current.accessInstructions.trim() || null;
  }

  return payload;
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
    errors.name = 'properties.edit.error.name_required';
  } else if (state.name.length > PROPERTY_NAME_MAX_LENGTH) {
    errors.name = 'properties.edit.error.name_too_long';
  }
  if (!state.type) {
    errors.type = 'properties.edit.error.type_required';
  }
  const sqm = Number(state.squareMeters);
  if (!state.squareMeters || sqm <= 0) {
    errors.squareMeters = 'properties.edit.error.sqm_invalid';
  } else if (sqm > PROPERTY_MAX_SQM) {
    errors.squareMeters = 'properties.edit.error.sqm_too_large';
  }
  const bedrooms = Number(state.bedrooms);
  if (isNaN(bedrooms) || bedrooms < 0 || bedrooms > PROPERTY_MAX_BEDROOMS) {
    errors.bedrooms = 'properties.edit.error.bedrooms_invalid';
  }
  const bathrooms = Number(state.bathrooms);
  if (isNaN(bathrooms) || bathrooms < 1 || bathrooms > PROPERTY_MAX_BATHROOMS) {
    errors.bathrooms = 'properties.edit.error.bathrooms_invalid';
  }
  return errors;
}

function validateStep2(state: FormState): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!state.address.street?.trim()) {
    errors.street = 'properties.edit.error.street_required';
  }
  if (!state.address.city?.trim()) {
    errors.city = 'properties.edit.error.city_required';
  }
  if (!state.address.country) {
    errors.country = 'properties.edit.error.country_required';
  }
  if (!state.coordinates) {
    errors.coordinates = 'properties.edit.error.location_required';
  }
  return errors;
}

function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface EditPropertyScreenProps {
  propertyId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * EditPropertyScreen — multi-step form for updating an existing property.
 *
 * Pre-populates all fields from the existing property detail.
 * Saves only changed fields via PATCH endpoint.
 * Updates locationSource when address is re-geocoded or pin is moved.
 */
export function EditPropertyScreen({
  propertyId,
  onSuccess,
  onCancel,
}: EditPropertyScreenProps) {
  const { t } = useTranslation();
  const {
    updateProperty,
    geocode,
    reverseGeocode,
    fetchDetail,
    selectedProperty,
    isDetailLoading,
    isMutating,
    error,
    clearError,
  } = useProperties();

  const [currentStep, setCurrentStep] = useState(1);
  const [form, dispatch] = useReducer(formReducer, {
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
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingError, setGeocodingError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** Snapshot of original form state for diff computation */
  const originalFormRef = useRef<FormState | null>(null);

  // ─── Fetch Property Data ───────────────────────────────────────────────

  useEffect(() => {
    loadPropertyData();
  }, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPropertyData = useCallback(async () => {
    setFetchError(null);
    try {
      await fetchDetail(propertyId);
    } catch {
      setFetchError('properties.edit.error.fetch_failed');
    }
  }, [fetchDetail, propertyId]);

  // ─── Initialize Form from Property ────────────────────────────────────

  useEffect(() => {
    if (selectedProperty && selectedProperty.id === propertyId && !isInitialized) {
      const initialState = buildFormStateFromProperty(selectedProperty);
      dispatch({ type: 'INIT_FROM_PROPERTY', payload: initialState });
      originalFormRef.current = initialState;
      setIsInitialized(true);
    }
  }, [selectedProperty, propertyId, isInitialized]);

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
        setGeocodingError('properties.edit.geocoding_failed_manual');
      }
    } catch {
      setGeocodingError('properties.edit.geocoding_failed_manual');
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
    if (!originalFormRef.current) return;

    clearError();
    const payload = computeChangedFields(originalFormRef.current, form);

    // If nothing changed, just call onSuccess
    if (Object.keys(payload).length === 0) {
      onSuccess?.();
      return;
    }

    try {
      await updateProperty(propertyId, payload);
      onSuccess?.();
    } catch {
      // Error is shown via store error state
    }
  }, [form, updateProperty, clearError, onSuccess, propertyId]);

  // ─── Computed ──────────────────────────────────────────────────────────

  const isLastStep = currentStep === TOTAL_STEPS;
  const canSubmit = useMemo(() => {
    if (isMutating) return false;
    if (!form.type || !form.coordinates) return false;
    return true;
  }, [isMutating, form.type, form.coordinates]);

  // ─── Loading State ─────────────────────────────────────────────────────

  if (isDetailLoading || !isInitialized) {
    if (fetchError) {
      return (
        <SafeAreaView style={styles.container} testID="edit-property-screen">
          <View style={styles.centeredContainer}>
            <Text style={styles.errorText} accessibilityRole="alert">
              {t(fetchError, { defaultValue: 'Failed to load property' })}
            </Text>
            <Pressable
              style={styles.retryButton}
              onPress={loadPropertyData}
              accessibilityRole="button"
              accessibilityLabel={t('properties.edit.retry', { defaultValue: 'Retry' })}
              testID="edit-property-retry-btn"
            >
              <Text style={styles.retryButtonText}>
                {t('properties.edit.retry', { defaultValue: 'Retry' })}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container} testID="edit-property-screen">
        <View style={styles.centeredContainer}>
          <ActivityIndicator
            size="large"
            color={COLORS.accent}
            testID="edit-property-loading"
          />
          <Text style={styles.loadingText}>
            {t('properties.edit.loading', { defaultValue: 'Loading property...' })}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} testID="edit-property-screen">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t('properties.edit.back', { defaultValue: 'Go back' })}
            testID="edit-property-back-btn"
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>
              {currentStep === 1
                ? t('properties.edit.cancel', { defaultValue: 'Cancel' })
                : t('properties.edit.back_label', { defaultValue: 'Back' })}
            </Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {t('properties.edit.title', { defaultValue: 'Edit Property' })}
          </Text>
          <View style={styles.headerButton} />
        </View>

        {/* Step Indicator */}
        <EditStepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />

        {/* Step Content */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={animatedStepStyle}>
            {currentStep === 1 && (
              <EditStep1BasicInfo
                form={form}
                dispatch={dispatch}
                errors={validationErrors}
              />
            )}
            {currentStep === 2 && (
              <EditStep2Address
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
              <EditStep3Details
                form={form}
                dispatch={dispatch}
                photos={selectedProperty?.photos ?? []}
              />
            )}
          </Animated.View>

          {/* Error from store */}
          {error && (
            <Text style={styles.errorText} accessibilityRole="alert" testID="edit-property-error">
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
              accessibilityLabel={t('properties.edit.submit', { defaultValue: 'Save Changes' })}
              accessibilityState={{ disabled: !canSubmit }}
              testID="edit-property-submit-btn"
            >
              {isMutating ? (
                <ActivityIndicator color={COLORS.background} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {t('properties.edit.submit', { defaultValue: 'Save Changes' })}
                </Text>
              )}
            </Pressable>
          ) : (
            <Pressable
              style={styles.primaryButton}
              onPress={goNext}
              accessibilityRole="button"
              accessibilityLabel={t('properties.edit.next', { defaultValue: 'Next' })}
              testID="edit-property-next-btn"
            >
              <Text style={styles.primaryButtonText}>
                {t('properties.edit.next', { defaultValue: 'Next' })}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

interface EditStepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

function EditStepIndicator({ currentStep, totalSteps }: EditStepIndicatorProps) {
  const { t } = useTranslation();

  return (
    <View
      style={styles.stepIndicator}
      accessibilityRole="progressbar"
      accessibilityLabel={t('properties.edit.step_indicator', {
        current: currentStep,
        total: totalSteps,
        defaultValue: `Step ${currentStep} of ${totalSteps}`,
      })}
      testID="edit-step-indicator"
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

interface EditStep1Props {
  form: FormState;
  dispatch: React.Dispatch<FormAction>;
  errors: ValidationErrors;
}

function EditStep1BasicInfo({ form, dispatch, errors }: EditStep1Props) {
  const { t } = useTranslation();

  return (
    <View testID="edit-step-1-basic-info">
      {/* Property Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.name_label', { defaultValue: 'Property Name' })} *
        </Text>
        <TextInput
          style={[styles.textInput, errors.name && styles.textInputError]}
          value={form.name}
          onChangeText={(v) => dispatch({ type: 'SET_NAME', payload: v })}
          placeholder={t('properties.edit.name_placeholder', { defaultValue: 'e.g. My Apartment' })}
          placeholderTextColor={COLORS.textSecondary}
          maxLength={PROPERTY_NAME_MAX_LENGTH}
          accessibilityLabel={t('properties.edit.name_label', { defaultValue: 'Property Name' })}
          testID="edit-input-property-name"
        />
        {errors.name && (
          <Text style={styles.fieldError}>{t(errors.name, { defaultValue: errors.name })}</Text>
        )}
      </View>

      {/* Property Type */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.type_label', { defaultValue: 'Property Type' })} *
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
          {t('properties.edit.description_label', { defaultValue: 'Description (optional)' })}
        </Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          value={form.description}
          onChangeText={(v) => dispatch({ type: 'SET_DESCRIPTION', payload: v })}
          placeholder={t('properties.edit.description_placeholder', { defaultValue: 'Describe your property...' })}
          placeholderTextColor={COLORS.textSecondary}
          maxLength={PROPERTY_DESCRIPTION_MAX_LENGTH}
          multiline
          numberOfLines={3}
          accessibilityLabel={t('properties.edit.description_label', { defaultValue: 'Description' })}
          testID="edit-input-property-description"
        />
      </View>

      {/* Square Meters */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.sqm_label', { defaultValue: 'Square Meters' })} *
        </Text>
        <TextInput
          style={[styles.textInput, errors.squareMeters && styles.textInputError]}
          value={form.squareMeters}
          onChangeText={(v) => dispatch({ type: 'SET_SQUARE_METERS', payload: v.replace(/[^0-9.]/g, '') })}
          placeholder="0"
          placeholderTextColor={COLORS.textSecondary}
          keyboardType="numeric"
          accessibilityLabel={t('properties.edit.sqm_label', { defaultValue: 'Square Meters' })}
          testID="edit-input-square-meters"
        />
        {errors.squareMeters && (
          <Text style={styles.fieldError}>{t(errors.squareMeters, { defaultValue: errors.squareMeters })}</Text>
        )}
      </View>

      {/* Bedrooms + Bathrooms Row */}
      <View style={styles.rowFields}>
        <View style={[styles.fieldGroup, styles.halfField]}>
          <Text style={styles.fieldLabel}>
            {t('properties.edit.bedrooms_label', { defaultValue: 'Bedrooms' })}
          </Text>
          <TextInput
            style={[styles.textInput, errors.bedrooms && styles.textInputError]}
            value={form.bedrooms}
            onChangeText={(v) => dispatch({ type: 'SET_BEDROOMS', payload: v.replace(/[^0-9]/g, '') })}
            placeholder="0"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="numeric"
            accessibilityLabel={t('properties.edit.bedrooms_label', { defaultValue: 'Bedrooms' })}
            testID="edit-input-bedrooms"
          />
          {errors.bedrooms && (
            <Text style={styles.fieldError}>{t(errors.bedrooms, { defaultValue: errors.bedrooms })}</Text>
          )}
        </View>
        <View style={[styles.fieldGroup, styles.halfField]}>
          <Text style={styles.fieldLabel}>
            {t('properties.edit.bathrooms_label', { defaultValue: 'Bathrooms' })} *
          </Text>
          <TextInput
            style={[styles.textInput, errors.bathrooms && styles.textInputError]}
            value={form.bathrooms}
            onChangeText={(v) => dispatch({ type: 'SET_BATHROOMS', payload: v.replace(/[^0-9]/g, '') })}
            placeholder="1"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="numeric"
            accessibilityLabel={t('properties.edit.bathrooms_label', { defaultValue: 'Bathrooms' })}
            testID="edit-input-bathrooms"
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

interface EditStep2Props {
  form: FormState;
  dispatch: React.Dispatch<FormAction>;
  errors: ValidationErrors;
  isGeocoding: boolean;
  geocodingError: string | null;
  onGeocode: () => void;
  onMapLocationChange: (coords: Coordinates) => void;
}

function EditStep2Address({
  form,
  dispatch,
  errors,
  isGeocoding,
  geocodingError,
  onGeocode,
  onMapLocationChange,
}: EditStep2Props) {
  const { t } = useTranslation();

  return (
    <View testID="edit-step-2-address">
      {/* Address Input */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.address_label', { defaultValue: 'Address' })} *
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
          {t('properties.edit.map_label', { defaultValue: 'Location on Map' })}
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
            {t('properties.edit.pin_hint', { defaultValue: 'Tap the map to place the pin manually.' })}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Step 3: Details (Photos read-only) ──────────────────────────────────────

interface EditStep3Props {
  form: FormState;
  dispatch: React.Dispatch<FormAction>;
  photos: Property['photos'];
}

function EditStep3Details({ form, dispatch, photos }: EditStep3Props) {
  const { t } = useTranslation();

  return (
    <View testID="edit-step-3-details">
      {/* Photos (read-only display) */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.photos_label', { defaultValue: 'Photos' })}
        </Text>
        <View style={styles.photoReadOnly}>
          {photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {photos.map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.url }}
                  style={styles.photoThumbnail}
                  accessibilityLabel={t('properties.edit.photo_thumbnail', { defaultValue: 'Property photo' })}
                  testID={`edit-photo-${photo.id}`}
                />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.photoNote}>
              {t('properties.edit.no_photos', { defaultValue: 'No photos yet' })}
            </Text>
          )}
          <Text style={styles.photoNote}>
            {t('properties.edit.photos_managed_elsewhere', {
              defaultValue: 'Photos are managed from the property detail screen.',
            })}
          </Text>
        </View>
      </View>

      {/* Checklist */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.checklist_label', { defaultValue: 'Cleaning Checklist' })}
        </Text>
        <ChecklistEditor
          items={form.checklistItems}
          onChange={(items) => dispatch({ type: 'SET_CHECKLIST', payload: items })}
        />
      </View>

      {/* Requirements */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.requirements_label', { defaultValue: 'Special Requirements' })}
        </Text>
        <RequirementsChips
          selected={form.specialRequirements}
          onChange={(reqs) => dispatch({ type: 'SET_REQUIREMENTS', payload: reqs })}
        />
      </View>

      {/* Access Instructions */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.access_instructions_label', { defaultValue: 'Access Instructions (optional)' })}
        </Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          value={form.accessInstructions}
          onChangeText={(v) => dispatch({ type: 'SET_ACCESS_INSTRUCTIONS', payload: v })}
          placeholder={t('properties.edit.access_instructions_placeholder', { defaultValue: 'How to access the property...' })}
          placeholderTextColor={COLORS.textSecondary}
          multiline
          numberOfLines={3}
          accessibilityLabel={t('properties.edit.access_instructions_label', { defaultValue: 'Access Instructions' })}
          testID="edit-input-access-instructions"
        />
      </View>

      {/* Floor Number */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {t('properties.edit.floor_label', { defaultValue: 'Floor Number (optional)' })}
        </Text>
        <TextInput
          style={styles.textInput}
          value={form.floorNumber}
          onChangeText={(v) => dispatch({ type: 'SET_FLOOR_NUMBER', payload: v.replace(/[^0-9]/g, '') })}
          placeholder="0"
          placeholderTextColor={COLORS.textSecondary}
          keyboardType="numeric"
          accessibilityLabel={t('properties.edit.floor_label', { defaultValue: 'Floor Number' })}
          testID="edit-input-floor-number"
        />
      </View>

      {/* Parking Toggle */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>
          {t('properties.edit.has_parking', { defaultValue: 'Has Parking' })}
        </Text>
        <Switch
          value={form.hasParking}
          onValueChange={(v) => dispatch({ type: 'SET_HAS_PARKING', payload: v })}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          accessibilityRole="switch"
          accessibilityLabel={t('properties.edit.has_parking', { defaultValue: 'Has Parking' })}
          testID="edit-switch-has-parking"
        />
      </View>

      {/* Elevator Toggle */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>
          {t('properties.edit.has_elevator', { defaultValue: 'Has Elevator' })}
        </Text>
        <Switch
          value={form.hasElevator}
          onValueChange={(v) => dispatch({ type: 'SET_HAS_ELEVATOR', payload: v })}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          accessibilityRole="switch"
          accessibilityLabel={t('properties.edit.has_elevator', { defaultValue: 'Has Elevator' })}
          testID="edit-switch-has-elevator"
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
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.body,
    marginTop: SPACING.md,
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
  photoReadOnly: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    padding: SPACING.md,
  },
  photoThumbnail: {
    width: PHOTO_THUMBNAIL_SIZE,
    height: PHOTO_THUMBNAIL_SIZE,
    borderRadius: SPACING.sm,
    marginRight: SPACING.sm,
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
    borderRadius: BUTTON_BORDER_RADIUS,
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
  retryButton: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 4,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  retryButtonText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.accent,
    fontWeight: '600',
  },
});

export default EditPropertyScreen;

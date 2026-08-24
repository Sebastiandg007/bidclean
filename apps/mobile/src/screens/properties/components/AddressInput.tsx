/**
 * AddressInput
 *
 * Structured address form with fields for street, city, state, postal code,
 * and a country selector using horizontal chips. Includes a "Locate on Map"
 * button that triggers forward geocoding, with a fallback error message
 * when geocoding fails — prompting the user to place a pin manually.
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  COLORS,
  FONT_SIZE,
  SPACING,
  SUPPORTED_COUNTRIES,
} from '../properties.constants';
import type { PropertyAddress, SupportedCountry } from '../properties.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AddressInputProps {
  value?: Partial<PropertyAddress>;
  onChange?: (address: Partial<PropertyAddress>) => void;
  onGeocode?: () => void;
  isGeocoding?: boolean;
  geocodingError?: string | null;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const INPUT_BORDER_RADIUS = 10;
const CHIP_BORDER_RADIUS = 16;
const BUTTON_BORDER_RADIUS = 12;
const CHIP_BORDER_WIDTH = 1.5;
const SELECTED_CHIP_BORDER_WIDTH = 2;

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface CountryChipProps {
  code: SupportedCountry;
  labelKey: string;
  isSelected: boolean;
  onSelect: (code: SupportedCountry) => void;
}

/** Individual country selection chip */
function CountryChip({ code, labelKey, isSelected, onSelect }: CountryChipProps) {
  const { t } = useTranslation();

  const handlePress = useCallback(() => {
    onSelect(code);
  }, [onSelect, code]);

  const label = t(labelKey, { defaultValue: code });

  return (
    <Pressable
      style={[styles.chip, isSelected && styles.chipSelected]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={t('properties.address.country_chip_a11y', {
        defaultValue: '{{country}}, country',
        country: label,
      })}
      testID={`country-chip-${code}`}
    >
      <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Renders structured address fields with a country selector and geocode action.
 *
 * @param value - Current address values
 * @param onChange - Callback when any field changes
 * @param onGeocode - Callback to trigger forward geocoding
 * @param isGeocoding - Whether geocoding is in progress
 * @param geocodingError - Error message from failed geocoding attempt
 */
export const AddressInput: React.FC<AddressInputProps> = ({
  value,
  onChange,
  onGeocode,
  isGeocoding = false,
  geocodingError = null,
}) => {
  const { t } = useTranslation();

  const handleFieldChange = useCallback(
    (field: keyof PropertyAddress, text: string) => {
      onChange?.({ ...value, [field]: text || null });
    },
    [onChange, value],
  );

  const handleStreetChange = useCallback(
    (text: string) => handleFieldChange('street', text),
    [handleFieldChange],
  );

  const handleCityChange = useCallback(
    (text: string) => handleFieldChange('city', text),
    [handleFieldChange],
  );

  const handleStateChange = useCallback(
    (text: string) => handleFieldChange('state', text),
    [handleFieldChange],
  );

  const handlePostalCodeChange = useCallback(
    (text: string) => handleFieldChange('postalCode', text),
    [handleFieldChange],
  );

  const handleCountrySelect = useCallback(
    (code: SupportedCountry) => {
      onChange?.({ ...value, country: code });
    },
    [onChange, value],
  );

  // Geocode button is disabled when street or city are empty
  const canGeocode = Boolean(value?.street?.trim() && value?.city?.trim());
  const isButtonDisabled = isGeocoding || !canGeocode;

  return (
    <View style={styles.container} testID="address-input">
      {/* Street */}
      <View style={styles.fieldWrapper}>
        <Text style={styles.label}>
          {t('properties.address.street_label', { defaultValue: 'Street' })}
        </Text>
        <TextInput
          style={styles.input}
          value={value?.street ?? ''}
          onChangeText={handleStreetChange}
          placeholder={t('properties.address.street_placeholder', {
            defaultValue: 'Street address',
          })}
          placeholderTextColor={COLORS.textSecondary}
          accessibilityLabel={t('properties.address.street_a11y', {
            defaultValue: 'Street address input',
          })}
          testID="address-input-street"
        />
      </View>

      {/* City */}
      <View style={styles.fieldWrapper}>
        <Text style={styles.label}>
          {t('properties.address.city_label', { defaultValue: 'City' })}
        </Text>
        <TextInput
          style={styles.input}
          value={value?.city ?? ''}
          onChangeText={handleCityChange}
          placeholder={t('properties.address.city_placeholder', {
            defaultValue: 'City',
          })}
          placeholderTextColor={COLORS.textSecondary}
          accessibilityLabel={t('properties.address.city_a11y', {
            defaultValue: 'City input',
          })}
          testID="address-input-city"
        />
      </View>

      {/* State & Postal Code — side by side */}
      <View style={styles.row}>
        <View style={[styles.fieldWrapper, styles.halfField]}>
          <Text style={styles.label}>
            {t('properties.address.state_label', { defaultValue: 'State' })}
          </Text>
          <TextInput
            style={styles.input}
            value={value?.state ?? ''}
            onChangeText={handleStateChange}
            placeholder={t('properties.address.state_placeholder', {
              defaultValue: 'State / Province',
            })}
            placeholderTextColor={COLORS.textSecondary}
            accessibilityLabel={t('properties.address.state_a11y', {
              defaultValue: 'State or province input',
            })}
            testID="address-input-state"
          />
        </View>

        <View style={[styles.fieldWrapper, styles.halfField]}>
          <Text style={styles.label}>
            {t('properties.address.postal_code_label', { defaultValue: 'Postal Code' })}
          </Text>
          <TextInput
            style={styles.input}
            value={value?.postalCode ?? ''}
            onChangeText={handlePostalCodeChange}
            placeholder={t('properties.address.postal_code_placeholder', {
              defaultValue: 'Zip / Postal',
            })}
            placeholderTextColor={COLORS.textSecondary}
            accessibilityLabel={t('properties.address.postal_code_a11y', {
              defaultValue: 'Postal code input',
            })}
            keyboardType="default"
            testID="address-input-postal-code"
          />
        </View>
      </View>

      {/* Country Selector */}
      <View style={styles.fieldWrapper}>
        <Text style={styles.label}>
          {t('properties.address.country_label', { defaultValue: 'Country' })}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          testID="address-input-country-selector"
        >
          {SUPPORTED_COUNTRIES.map((item) => (
            <CountryChip
              key={item.code}
              code={item.code}
              labelKey={item.labelKey}
              isSelected={value?.country === item.code}
              onSelect={handleCountrySelect}
            />
          ))}
        </ScrollView>
      </View>

      {/* Locate on Map Button */}
      <Pressable
        style={[styles.geocodeButton, isButtonDisabled && styles.geocodeButtonDisabled]}
        onPress={onGeocode}
        disabled={isButtonDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('properties.address.locate_a11y', {
          defaultValue: 'Locate address on map',
        })}
        accessibilityState={{ disabled: isButtonDisabled }}
        testID="address-input-geocode-button"
      >
        {isGeocoding ? (
          <ActivityIndicator
            size="small"
            color={COLORS.background}
            testID="address-input-geocoding-loader"
          />
        ) : (
          <Text style={[styles.geocodeButtonText, isButtonDisabled && styles.geocodeButtonTextDisabled]}>
            {t('properties.address.locate_button', { defaultValue: 'Locate on Map' })}
          </Text>
        )}
      </Pressable>

      {/* Geocoding Error Fallback */}
      {geocodingError ? (
        <View style={styles.errorContainer} testID="address-input-geocoding-error">
          <Text style={styles.errorText}>
            {t('properties.address.geocoding_error', {
              defaultValue: geocodingError,
            })}
          </Text>
          <Text style={styles.errorHint}>
            {t('properties.address.geocoding_fallback', {
              defaultValue: 'Place the pin manually on the map instead.',
            })}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: SPACING.md,
  },
  fieldWrapper: {
    gap: SPACING.xs,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.label,
    fontWeight: '500',
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: INPUT_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + SPACING.xs,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  halfField: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  chip: {
    backgroundColor: COLORS.card,
    borderRadius: CHIP_BORDER_RADIUS,
    borderWidth: CHIP_BORDER_WIDTH,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  chipSelected: {
    borderWidth: SELECTED_CHIP_BORDER_WIDTH,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSubtle,
  },
  chipLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.label,
    fontWeight: '500',
  },
  chipLabelSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  geocodeButton: {
    backgroundColor: COLORS.accent,
    borderRadius: BUTTON_BORDER_RADIUS,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  geocodeButtonDisabled: {
    opacity: 0.4,
  },
  geocodeButtonText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
  },
  geocodeButtonTextDisabled: {
    opacity: 0.6,
  },
  errorContainer: {
    backgroundColor: COLORS.errorSubtle,
    borderRadius: INPUT_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.error,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '500',
  },
  errorHint: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.caption,
  },
});

export default AddressInput;

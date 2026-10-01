/**
 * RegisterScreen — Collects BidClean-specific user fields before Keycloak auth.
 *
 * Gathers full name, country (ISO 3166-1 alpha-2), and preferred language (BCP 47).
 * After submission, the user is redirected to Keycloak for credential creation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
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
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';

import type { RegisterScreenProps } from './auth.types';
import { makeStyles, useTheme } from '../../theme';

// ─── Design Tokens ───────────────────────────────────────────────────────────

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
  input: 16,
  button: 17,
  pickerItem: 16,
  label: 13,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const ANIMATION_DELAY_MS = 150;

// ─── Data ────────────────────────────────────────────────────────────────────

interface CountryOption {
  code: string;
  name: string;
  flag: string;
}

const COUNTRIES: CountryOption[] = [
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
];

interface LanguageOption {
  code: string;
  name: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
];

const MINIMUM_NAME_LENGTH = 2;

// ─── Validation ──────────────────────────────────────────────────────────────

function isNameValid(name: string): boolean {
  return name.trim().length >= MINIMUM_NAME_LENGTH;
}

function isFormComplete(fullName: string, country: string, language: string): boolean {
  return isNameValid(fullName) && country !== '' && language !== '';
}

// ─── Picker Modal Component ──────────────────────────────────────────────────

interface PickerModalProps<T extends { code: string }> {
  visible: boolean;
  title: string;
  items: T[];
  searchPlaceholder: string;
  renderLabel: (item: T) => string;
  onSelect: (item: T) => void;
  onClose: () => void;
}

function PickerModal<T extends { code: string }>({
  visible,
  title,
  items,
  searchPlaceholder,
  renderLabel,
  onSelect,
  onClose,
}: PickerModalProps<T>) {
  const styles = useStyles();
  const { theme } = useTheme();
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const query = search.toLowerCase();
    return items.filter((item) => renderLabel(item).toLowerCase().includes(query));
  }, [items, search, renderLabel]);

  const handleSelect = useCallback(
    (item: T) => {
      onSelect(item);
      setSearch('');
    },
    [onSelect],
  );

  const handleClose = useCallback(() => {
    setSearch('');
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder}
            placeholderTextColor={theme.textMuted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            accessibilityLabel={`Search ${title}`}
          />

          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <Pressable
                style={styles.pickerItem}
                onPress={() => handleSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${renderLabel(item)}`}
              >
                <Text style={styles.pickerItemText}>{renderLabel(item)}</Text>
              </Pressable>
            )}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RegisterScreen({ onContinue }: RegisterScreenProps) {
  const router = useRouter();
  const styles = useStyles();
  const { theme } = useTheme();

  // Form state
  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');

  // Picker visibility
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const [isLanguagePickerVisible, setIsLanguagePickerVisible] = useState(false);

  // Derived state
  const formValid = isFormComplete(fullName, country, language);

  const selectedCountry = useMemo(
    () => COUNTRIES.find((c) => c.code === country),
    [country],
  );

  const selectedLanguage = useMemo(
    () => LANGUAGES.find((l) => l.code === language),
    [language],
  );

  // ─── Animations ──────────────────────────────────────────────────────────

  const formOpacity = useSharedValue(0);
  const formTranslateY = useSharedValue(20);

  useEffect(() => {
    formOpacity.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    formTranslateY.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(0, SPRING_CONFIG),
    );
  }, [formOpacity, formTranslateY]);

  const formAnimatedStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formTranslateY.value }],
  }));

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleCountrySelect = useCallback((item: CountryOption) => {
    setCountry(item.code);
    setIsCountryPickerVisible(false);
  }, []);

  const handleLanguageSelect = useCallback((item: LanguageOption) => {
    setLanguage(item.code);
    setIsLanguagePickerVisible(false);
  }, []);

  const renderCountryLabel = useCallback(
    (item: CountryOption) => `${item.flag} ${item.name}`,
    [],
  );

  const renderLanguageLabel = useCallback(
    (item: LanguageOption) => item.name,
    [],
  );

  const handleContinue = useCallback(() => {
    if (!formValid) return;

    if (onContinue) {
      onContinue({ fullName: fullName.trim(), country, language });
      return;
    }

    // Navigate to Keycloak registration flow
    router.push('/verify-email' as never);
  }, [formValid, fullName, country, language, onContinue, router]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.formContainer, formAnimatedStyle]}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.title}>Create your profile</Text>
          <Text style={styles.subtitle}>
            Tell us a bit about yourself to get started
          </Text>
        </View>

        {/* Full Name Input */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Your full name"
            placeholderTextColor={theme.textMuted}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            autoCorrect={false}
            keyboardType="default"
            returnKeyType="done"
            accessibilityLabel="Full name input"
            accessibilityHint="Enter your full name, minimum 2 characters"
          />
          {fullName.length > 0 && !isNameValid(fullName) && (
            <Text style={styles.errorText}>Name must be at least 2 characters</Text>
          )}
        </View>

        {/* Country Picker */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Country</Text>
          <Pressable
            style={styles.pickerButton}
            onPress={() => setIsCountryPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Select your country"
            accessibilityHint="Opens a list of available countries"
          >
            <Text
              style={[
                styles.pickerButtonText,
                !selectedCountry && styles.pickerPlaceholderText,
              ]}
            >
              {selectedCountry
                ? `${selectedCountry.flag} ${selectedCountry.name}`
                : 'Select your country'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        {/* Language Picker */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Preferred Language</Text>
          <Pressable
            style={styles.pickerButton}
            onPress={() => setIsLanguagePickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Select your preferred language"
            accessibilityHint="Opens a list of available languages"
          >
            <Text
              style={[
                styles.pickerButtonText,
                !selectedLanguage && styles.pickerPlaceholderText,
              ]}
            >
              {selectedLanguage ? selectedLanguage.name : 'Select your language'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        {/* Continue Button */}
        <View style={styles.ctaSection}>
          <Pressable
            style={[styles.continueButton, !formValid && styles.continueButtonDisabled]}
            onPress={handleContinue}
            disabled={!formValid}
            accessibilityRole="button"
            accessibilityLabel="Continue to create account"
            accessibilityState={{ disabled: !formValid }}
          >
            <Text
              style={[
                styles.continueButtonText,
                !formValid && styles.continueButtonTextDisabled,
              ]}
            >
              Continue
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* Country Picker Modal */}
      <PickerModal
        visible={isCountryPickerVisible}
        title="Select Country"
        items={COUNTRIES}
        searchPlaceholder="Search countries..."
        renderLabel={renderCountryLabel}
        onSelect={handleCountrySelect}
        onClose={() => setIsCountryPickerVisible(false)}
      />

      {/* Language Picker Modal */}
      <PickerModal
        visible={isLanguagePickerVisible}
        title="Select Language"
        items={LANGUAGES}
        searchPlaceholder="Search languages..."
        renderLabel={renderLanguageLabel}
        onSelect={handleLanguageSelect}
        onClose={() => setIsLanguagePickerVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: SPACING.lg,
  },
  formContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerSection: {
    marginBottom: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: theme.textSecondary,
    marginTop: SPACING.sm,
  },
  fieldGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: theme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },
  textInput: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZE.input,
    color: theme.textPrimary,
    borderWidth: 1,
    borderColor: theme.border,
  },
  errorText: {
    fontSize: 12,
    color: theme.danger,
    marginTop: SPACING.xs,
  },
  pickerButton: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerButtonText: {
    fontSize: FONT_SIZE.input,
    color: theme.textPrimary,
  },
  pickerPlaceholderText: {
    color: theme.textSecondary,
  },
  chevron: {
    fontSize: 20,
    color: theme.textSecondary,
  },
  ctaSection: {
    marginTop: SPACING.xl,
  },
  continueButton: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.4,
  },
  continueButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: theme.onAccent,
  },
  continueButtonTextDisabled: {
    color: theme.onAccent,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: SPACING.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  modalTitle: {
    fontSize: FONT_SIZE.input,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  modalCloseText: {
    fontSize: 20,
    color: theme.textSecondary,
    padding: SPACING.sm,
  },
  searchInput: {
    backgroundColor: theme.background,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: 10,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    fontSize: FONT_SIZE.input,
    color: theme.textPrimary,
    borderWidth: 1,
    borderColor: theme.border,
  },
  pickerItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  pickerItemText: {
    fontSize: FONT_SIZE.pickerItem,
    color: theme.textPrimary,
  },
}));

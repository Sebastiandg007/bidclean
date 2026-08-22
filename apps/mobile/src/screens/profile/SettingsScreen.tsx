/**
 * SettingsScreen — Language selector, theme toggle, notification preferences.
 *
 * Changes apply immediately (no restart required):
 * - Language change triggers i18n reload
 * - Theme change updates app appearance instantly
 * - All changes sync to backend for cross-device consistency
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { SettingsItem } from './components/SettingsItem';
import {
  useSettingsStore,
  SUPPORTED_LANGUAGES,
  VALID_THEMES,
} from './useSettings';
import type { SupportedLanguage } from './useSettings';
import type { ThemePreference } from './profile.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  accent: '#00F5D4',
  error: '#FF6B6B',
  inputBackground: '#2A3140',
  border: '#3A4250',
  overlay: 'rgba(0, 0, 0, 0.7)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

// ─── Layout Constants ────────────────────────────────────────────────────────

const MODAL_MAX_WIDTH = 360;
const BORDER_RADIUS_CARD = 12;
const BORDER_RADIUS_MODAL = 16;
const BORDER_RADIUS_OPTION = 8;

// ─── Sub-Components ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }): React.JSX.Element {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();

  const settings = useSettingsStore((s) => s.settings);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const error = useSettingsStore((s) => s.error);
  const loadFromLocal = useSettingsStore((s) => s.loadFromLocal);
  const fetchFromBackend = useSettingsStore((s) => s.fetchFromBackend);
  const updateLanguage = useSettingsStore((s) => s.updateLanguage);
  const updateTheme = useSettingsStore((s) => s.updateTheme);
  const updateNotification = useSettingsStore((s) => s.updateNotification);

  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
  const [themePickerVisible, setThemePickerVisible] = useState(false);

  // ─── Load Settings on Mount ──────────────────────────────────────────────

  useEffect(() => {
    loadFromLocal().then(() => {
      fetchFromBackend();
    });
  }, [loadFromLocal, fetchFromBackend]);

  // ─── Show Error Toast ────────────────────────────────────────────────────

  useEffect(() => {
    if (error) {
      Alert.alert(
        t('profile.settings.error.title'),
        t('profile.settings.error.sync_failed'),
      );
    }
  }, [error, t]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleLanguageSelect = useCallback(
    (language: SupportedLanguage) => {
      setLanguagePickerVisible(false);
      updateLanguage(language);
    },
    [updateLanguage],
  );

  const handleThemeSelect = useCallback(
    (theme: ThemePreference) => {
      setThemePickerVisible(false);
      updateTheme(theme);
    },
    [updateTheme],
  );

  // ─── Loading State ───────────────────────────────────────────────────────

  if (isLoading && !settings) {
    return (
      <SafeAreaView style={styles.centered} testID="settings-loading">
        <ActivityIndicator color={COLORS.accent} size="large" />
        <Text style={styles.loadingText}>
          {t('profile.settings.loading')}
        </Text>
      </SafeAreaView>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} testID="settings-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('profile.settings.title')}
          </Text>
        </View>

        {/* Language Section */}
        <SectionHeader title={t('profile.settings.section_language')} />
        <View style={styles.card}>
          <SettingsItem
            mode="selector"
            label={t('profile.settings.language_label')}
            displayValue={getLanguageDisplayName(
              settings?.language ?? 'en',
              t,
            )}
            onPress={() => setLanguagePickerVisible(true)}
            icon="🌐"
            testID="settings-language"
          />
        </View>

        {/* Theme Section */}
        <SectionHeader title={t('profile.settings.section_theme')} />
        <View style={styles.card}>
          <SettingsItem
            mode="selector"
            label={t('profile.settings.theme_label')}
            displayValue={getThemeDisplayName(
              settings?.theme ?? 'system',
              t,
            )}
            onPress={() => setThemePickerVisible(true)}
            icon="🎨"
            testID="settings-theme"
          />
        </View>

        {/* Notifications Section */}
        <SectionHeader title={t('profile.settings.section_notifications')} />
        <View style={styles.card}>
          <SettingsItem
            mode="toggle"
            label={t('profile.settings.push_notifications')}
            value={settings?.isPushEnabled ?? true}
            onValueChange={(value) =>
              updateNotification('isPushEnabled', value)
            }
            icon="🔔"
            testID="settings-push"
          />
          <SettingsItem
            mode="toggle"
            label={t('profile.settings.email_notifications')}
            value={settings?.isEmailNotificationsEnabled ?? true}
            onValueChange={(value) =>
              updateNotification('isEmailNotificationsEnabled', value)
            }
            icon="✉️"
            testID="settings-email"
          />
          <SettingsItem
            mode="toggle"
            label={t('profile.settings.sounds')}
            value={settings?.isSoundsEnabled ?? true}
            onValueChange={(value) =>
              updateNotification('isSoundsEnabled', value)
            }
            icon="🔊"
            testID="settings-sounds"
          />
        </View>
      </ScrollView>

      {/* Language Picker Modal */}
      <PickerModal
        visible={languagePickerVisible}
        title={t('profile.settings.select_language')}
        options={SUPPORTED_LANGUAGES.map((code) => ({
          key: code,
          label: getLanguageDisplayName(code, t),
        }))}
        selectedKey={settings?.language ?? 'en'}
        onSelect={(key) => handleLanguageSelect(key as SupportedLanguage)}
        onClose={() => setLanguagePickerVisible(false)}
        testID="language-picker"
      />

      {/* Theme Picker Modal */}
      <PickerModal
        visible={themePickerVisible}
        title={t('profile.settings.select_theme')}
        options={VALID_THEMES.map((theme) => ({
          key: theme,
          label: getThemeDisplayName(theme, t),
        }))}
        selectedKey={settings?.theme ?? 'system'}
        onSelect={(key) => handleThemeSelect(key as ThemePreference)}
        onClose={() => setThemePickerVisible(false)}
        testID="theme-picker"
      />
    </SafeAreaView>
  );
}

// ─── Picker Modal ────────────────────────────────────────────────────────────

interface PickerOption {
  key: string;
  label: string;
}

interface PickerModalProps {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  testID?: string;
}

function PickerModal({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
  testID,
}: PickerModalProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{title}</Text>
          {options.map((option) => (
            <Pressable
              key={option.key}
              style={[
                styles.optionRow,
                option.key === selectedKey && styles.optionRowSelected,
              ]}
              onPress={() => onSelect(option.key)}
              testID={testID ? `${testID}-option-${option.key}` : undefined}
            >
              <Text
                style={[
                  styles.optionText,
                  option.key === selectedKey && styles.optionTextSelected,
                ]}
              >
                {option.label}
              </Text>
              {option.key === selectedKey && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

function getLanguageDisplayName(
  code: string,
  t: (key: string) => string,
): string {
  return t(`profile.settings.languages.${code}`);
}

function getThemeDisplayName(
  theme: string,
  t: (key: string) => string,
): string {
  return t(`profile.settings.themes.${theme}`);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  loadingText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  headerTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sectionHeader: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.accent,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS_CARD,
    padding: SPACING.md,
  },
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS_MODAL,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: MODAL_MAX_WIDTH,
  },
  modalTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  optionRowSelected: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: BORDER_RADIUS_OPTION,
    paddingHorizontal: SPACING.sm,
  },
  optionText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textPrimary,
  },
  optionTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  checkmark: {
    fontSize: FONT_SIZE.md,
    color: COLORS.accent,
  },
});

export default SettingsScreen;

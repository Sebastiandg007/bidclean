/**
 * AccountScreen — Account operations.
 * Email change via system browser (Keycloak flow).
 * Password change via system browser (Keycloak flow).
 * Delete account with confirmation modal.
 */

import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';

import { SettingsItem } from './components/SettingsItem';
import { DeleteAccountModal } from './components/DeleteAccountModal';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '../../services/api.service';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  accent: '#00F5D4',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  md: 16,
  xl: 24,
} as const;

const BORDER_RADIUS_CARD = 12;

// ─── API Endpoints ───────────────────────────────────────────────────────────

const ENDPOINTS = {
  CHANGE_EMAIL: '/profile/me/change-email',
  CHANGE_PASSWORD: '/profile/me/change-password',
  DELETE_ACCOUNT: '/profile/me/delete-account',
} as const;

// ─── HTTP Status Codes ───────────────────────────────────────────────────────

const HTTP_ACCEPTED = 202;
const HTTP_CONFLICT = 409;

/**
 * Confirmation word sent to the server on delete request.
 * Server-side configurable via PROFILE_DELETE_CONFIRMATION_WORD env var.
 */
const CONFIRMATION_WORD = 'DELETE';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown, fallbackKey: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallbackKey;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }): React.JSX.Element {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AccountScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const resetAuth = useAuthStore((s) => s.reset);

  const [isDeleteModalVisible, setDeleteModalVisible] = useState(false);
  const [isDeletionLoading, setDeletionLoading] = useState(false);

  const handleChangeEmail = useCallback(async () => {
    try {
      const response = await apiClient.post<{ url: string }>(ENDPOINTS.CHANGE_EMAIL);
      await WebBrowser.openBrowserAsync(response.data.url);
    } catch (err) {
      const message = extractErrorMessage(err, t('profile.account.error.email_change_failed'));
      Alert.alert(t('profile.account.title'), message);
    }
  }, [t]);

  const handleChangePassword = useCallback(async () => {
    try {
      const response = await apiClient.post<{ url: string }>(ENDPOINTS.CHANGE_PASSWORD);
      await WebBrowser.openBrowserAsync(response.data.url);
    } catch (err) {
      const message = extractErrorMessage(err, t('profile.account.error.password_change_failed'));
      Alert.alert(t('profile.account.title'), message);
    }
  }, [t]);

  const handleDeletePress = useCallback(() => {
    setDeleteModalVisible(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setDeleteModalVisible(false);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    setDeletionLoading(true);

    try {
      const response = await apiClient.post(ENDPOINTS.DELETE_ACCOUNT, {
        confirmationWord: CONFIRMATION_WORD,
      });

      if (response.status === HTTP_ACCEPTED) {
        setDeleteModalVisible(false);
        resetAuth();
        router.replace('/welcome' as never);
      }
    } catch (err: unknown) {
      setDeleteModalVisible(false);

      const isConflict =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        (err as { response?: { status?: number } }).response?.status === HTTP_CONFLICT;

      const message = isConflict
        ? t('profile.account.error.active_services')
        : extractErrorMessage(err, t('profile.account.error.deletion_failed'));

      Alert.alert(t('profile.account.title'), message);
    } finally {
      setDeletionLoading(false);
    }
  }, [resetAuth, router, t]);

  return (
    <SafeAreaView style={styles.safeArea} testID="account-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('profile.account.title')}
          </Text>
        </View>

        {/* Security Section */}
        <SectionHeader title={t('profile.account.section_security')} />
        <View style={styles.card}>
          <SettingsItem
            mode="selector"
            label={t('profile.account.change_email')}
            displayValue=""
            onPress={handleChangeEmail}
            icon="✉️"
            testID="account-change-email"
          />
          <SettingsItem
            mode="selector"
            label={t('profile.account.change_password')}
            displayValue=""
            onPress={handleChangePassword}
            icon="🔒"
            testID="account-change-password"
          />
        </View>

        {/* Danger Zone Section */}
        <SectionHeader title={t('profile.account.section_danger')} />
        <View style={styles.card}>
          <SettingsItem
            mode="selector"
            label={t('profile.account.delete_account')}
            displayValue=""
            onPress={handleDeletePress}
            icon="⚠️"
            testID="account-delete"
          />
        </View>
      </ScrollView>

      {/* Delete Account Modal */}
      <DeleteAccountModal
        visible={isDeleteModalVisible}
        isLoading={isDeletionLoading}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </SafeAreaView>
  );
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
});

export default AccountScreen;

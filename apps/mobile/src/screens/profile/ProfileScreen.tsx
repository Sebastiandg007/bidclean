/**
 * ProfileScreen — Main profile view.
 *
 * Conditionally renders HostProfileCard or CleanerProfileCard based on active role.
 * Includes ProfileHeader with completeness ring, RoleSwitchButton or AddSecondRoleButton.
 * Fetches profile data on mount via useProfile hook.
 */

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  useAuthStore,
  selectActiveRole,
  selectHasBothRoles,
} from '../../stores/auth.store';
import { useProfileStore } from './useProfile';
import { ProfileHeader } from './components/ProfileHeader';
import { HostProfileCard } from './components/HostProfileCard';
import { CleanerProfileCard } from './components/CleanerProfileCard';
import RoleSwitchButton from './components/RoleSwitchButton';
import AddSecondRoleButton from './components/AddSecondRoleButton';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  accent: '#00F5D4',
  error: '#FF6B6B',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  sm: 14,
  md: 16,
  lg: 20,
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Main profile screen that orchestrates role-based profile rendering.
 * Fetches profile on mount and shows loading/error states as needed.
 */
export function ProfileScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const activeRole = useAuthStore(selectActiveRole);
  const hasBothRoles = useAuthStore(selectHasBothRoles);

  const profile = useProfileStore((s) => s.profile);
  const isLoading = useProfileStore((s) => s.isLoading);
  const error = useProfileStore((s) => s.error);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // ─── Loading State ───────────────────────────────────────────────────────

  if (isLoading && !profile) {
    return (
      <SafeAreaView style={styles.centered} testID="profile-loading">
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>
          {t('profile.loading', { defaultValue: 'Loading profile...' })}
        </Text>
      </SafeAreaView>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────────────

  if (error && !profile) {
    return (
      <SafeAreaView style={styles.centered} testID="profile-error">
        <Text style={styles.errorText}>
          {t('profile.error.fetchFailed', {
            defaultValue: 'Could not load profile',
          })}
        </Text>
        <Text style={styles.errorDetail}>{error}</Text>
      </SafeAreaView>
    );
  }

  // ─── Empty State ─────────────────────────────────────────────────────────

  if (!profile) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.emptyText}>
          {t('profile.empty', { defaultValue: 'No profile data available' })}
        </Text>
      </SafeAreaView>
    );
  }

  // ─── Main Content ────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} testID="profile-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <ProfileHeader
          common={profile.common}
          completeness={profile.completeness}
        />

        {/* Role-specific card */}
        {activeRole === 'host' && profile.host && (
          <HostProfileCard
            host={profile.host}
            memberSince={profile.common.memberSince}
          />
        )}

        {activeRole === 'cleaner' && profile.cleaner && (
          <CleanerProfileCard
            cleaner={profile.cleaner}
            memberSince={profile.common.memberSince}
          />
        )}

        {/* Role action buttons */}
        {hasBothRoles ? <RoleSwitchButton /> : <AddSecondRoleButton />}
      </ScrollView>
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
    paddingBottom: SPACING.xl,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  errorText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.error,
    textAlign: 'center',
  },
  errorDetail: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
});

export default ProfileScreen;

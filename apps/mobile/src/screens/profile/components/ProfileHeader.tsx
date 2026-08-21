/**
 * ProfileHeader — Displays profile photo, display name, member since,
 * email (read-only), and completeness ring.
 *
 * Tappable photo navigates to edit screen (where photo picker lives).
 * Uses useSignedUrl for photo URL freshness.
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { useSignedUrl } from '../useSignedUrl';
import { CompletenessRing } from './CompletenessRing';
import { PROFILE_ROUTES } from '../profile.constants';
import type { CommonProfile, ProfileCompleteness } from '../profile.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  background: '#0B0C10',
  placeholder: '#45A29E',
} as const;

const SPACING = {
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
} as const;

const PHOTO_SIZE = 80;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProfileHeaderProps {
  common: CommonProfile;
  completeness: ProfileCompleteness;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formats memberSince date to readable string */
function formatMemberSince(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Profile header with photo, name, metadata, and completeness ring.
 * Photo tap navigates to the Edit Profile screen.
 */
export function ProfileHeader({
  common,
  completeness,
}: ProfileHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const signedPhotoUrl = useSignedUrl(common.photoUrl);

  const handlePhotoPress = () => {
    router.push(PROFILE_ROUTES.EDIT_PROFILE);
  };

  const handleEditPress = () => {
    router.push(PROFILE_ROUTES.EDIT_PROFILE);
  };

  const memberSinceLabel = t('profile.header.memberSince', {
    defaultValue: `Member since ${formatMemberSince(common.memberSince)}`,
    date: formatMemberSince(common.memberSince),
  });

  const editButtonLabel = t('profile.header.editButton', {
    defaultValue: 'Edit Profile',
  });

  const photoA11y = t('profile.header.photo.a11y', {
    defaultValue: 'Profile photo, tap to edit',
  });

  return (
    <View style={styles.container} testID="profile-header">
      <View style={styles.topRow}>
        {/* Profile Photo */}
        <Pressable
          onPress={handlePhotoPress}
          accessibilityRole="button"
          accessibilityLabel={photoA11y}
          testID="profile-photo-button"
        >
          <View style={styles.photoContainer}>
            {signedPhotoUrl ? (
              <Image
                source={{ uri: signedPhotoUrl }}
                style={styles.photo}
                accessibilityLabel={t('profile.header.photo.image', {
                  defaultValue: `${common.displayName}'s profile photo`,
                  name: common.displayName,
                })}
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoInitial}>
                  {common.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

        {/* Completeness Ring */}
        <CompletenessRing percentage={completeness.percentage} size={80} />
      </View>

      {/* Name and metadata */}
      <View style={styles.infoSection}>
        <Text style={styles.displayName} numberOfLines={1}>
          {common.displayName}
        </Text>

        <Text style={styles.email} numberOfLines={1}>
          {common.email}
        </Text>

        <Text style={styles.memberSince}>
          {memberSinceLabel}
        </Text>
      </View>

      {/* Edit Profile Button */}
      <Pressable
        onPress={handleEditPress}
        style={styles.editButton}
        accessibilityRole="button"
        accessibilityLabel={editButtonLabel}
        testID="edit-profile-button"
      >
        <Text style={styles.editButtonText}>{editButtonLabel}</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: SPACING.md,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  photoContainer: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: FONT_SIZE.lg + 10,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  infoSection: {
    marginBottom: SPACING.md,
  },
  displayName: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm / 2,
  },
  email: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm / 2,
  },
  memberSince: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
  },
  editButton: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: SPACING.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.accent,
  },
});

export default ProfileHeader;

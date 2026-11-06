/**
 * PublicProfileScreen — Viewing another user's public profile.
 *
 * Displays only public fields via dedicated GET /profile/:userId endpoint.
 * Handles signed URL expiry for profile photos via useSignedUrl hook.
 * Shows: display name, photo, member since, bio, specialties, work zone label,
 * KYC badge, average rating, completed services, business name, portfolio gallery.
 * Private fields (email, phone, settings, exact coordinates) are NEVER exposed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';

import { useSignedUrl } from './useSignedUrl';
import type { PortfolioPhoto, PublicProfile } from './profile.types';
import { apiClient } from '../../services/api.service';
import { makeStyles, useTheme } from '../../theme';

// ─── Design Tokens ───────────────────────────────────────────────────────────

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
  xl: 24,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const PORTFOLIO_COLUMNS = 3;
const PORTFOLIO_GAP = SPACING.sm;
const SCREEN_WIDTH = Dimensions.get('window').width;
const PORTFOLIO_ITEM_SIZE =
  (SCREEN_WIDTH - SPACING.md * 2 - PORTFOLIO_GAP * (PORTFOLIO_COLUMNS - 1)) / PORTFOLIO_COLUMNS;
const PHOTO_SIZE = 96;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PublicProfileResponse extends PublicProfile {
  portfolioPhotos?: PortfolioPhoto[];
}

/** Formats rating to one decimal place or shows placeholder */
function formatRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return '—';
  return rating.toFixed(1);
}

/** Formats member since date as readable string */
function formatMemberSince(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface ProfilePhotoProps {
  photoUrl: string | null;
  displayName: string;
}

function ProfilePhoto({ photoUrl, displayName }: ProfilePhotoProps): React.JSX.Element {
  const styles = useStyles();
  const signedUrl = useSignedUrl(photoUrl);

  return (
    <View style={styles.photoContainer} testID="public-profile-photo">
      {signedUrl ? (
        <Image
          source={{ uri: signedUrl }}
          style={styles.photo}
          accessibilityLabel={displayName}
          testID="public-profile-photo-image"
        />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>
            {displayName.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

interface SpecialtyChipProps {
  label: string;
}

function SpecialtyChip({ label }: SpecialtyChipProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  testID?: string;
}

function StatRow({ label, value, testID }: StatRowProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.statRow} testID={testID}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

interface PortfolioItemProps {
  photo: PortfolioPhoto;
}

function PortfolioItem({ photo }: PortfolioItemProps): React.JSX.Element {
  const styles = useStyles();
  const signedUrl = useSignedUrl(photo.url);

  return (
    <View style={styles.portfolioItem} testID={`portfolio-item-${photo.id}`}>
      {signedUrl ? (
        <Image
          source={{ uri: signedUrl }}
          style={styles.portfolioImage}
          accessibilityLabel={`Portfolio photo ${photo.displayOrder + 1}`}
        />
      ) : (
        <View style={styles.portfolioPlaceholder} />
      )}
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PublicProfileScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { theme } = useTheme();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPublicProfile = useCallback(async () => {
    if (!userId) {
      setError(t('profile.public.notFound'));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<PublicProfileResponse>(`/profile/${userId}`);
      setProfile(response.data);
    } catch {
      setError(t('profile.public.error'));
    } finally {
      setIsLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    fetchPublicProfile();
  }, [fetchPublicProfile]);

  // ─── Loading State ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered} testID="public-profile-loading">
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.loadingText}>{t('profile.public.loading')}</Text>
      </SafeAreaView>
    );
  }

  // ─── Error State ───────────────────────────────────────────────────────

  if (error) {
    return (
      <SafeAreaView style={styles.centered} testID="public-profile-error">
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  // ─── Not Found State ───────────────────────────────────────────────────

  if (!profile) {
    return (
      <SafeAreaView style={styles.centered} testID="public-profile-not-found">
        <Text style={styles.errorText}>{t('profile.public.notFound')}</Text>
      </SafeAreaView>
    );
  }

  // ─── Main Content ──────────────────────────────────────────────────────

  const portfolioPhotos = profile.portfolioPhotos ?? [];
  const hasSpecialties = profile.specialties && profile.specialties.length > 0;
  const hasPortfolio = portfolioPhotos.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} testID="public-profile-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.headerCard} testID="public-profile-header">
          <ProfilePhoto photoUrl={profile.photoUrl} displayName={profile.displayName} />

          <Text style={styles.displayName} testID="public-profile-name">
            {profile.displayName}
          </Text>

          {/* Business Name (Host) */}
          {profile.businessName && (
            <Text style={styles.businessName} testID="public-profile-business-name">
              {profile.businessName}
            </Text>
          )}

          {/* Member Since */}
          <Text style={styles.memberSince} testID="public-profile-member-since">
            {t('profile.public.memberSince', { date: formatMemberSince(profile.memberSince) })}
          </Text>

          {/* KYC Badge */}
          {profile.kycBadge && (
            <View style={styles.kycBadge} testID="public-profile-kyc-badge">
              <Text style={styles.kycText}>{t('profile.public.kycVerified')}</Text>
            </View>
          )}
        </View>

        {/* Stats Card */}
        <View style={styles.card} testID="public-profile-stats">
          <StatRow
            label={t('profile.public.rating')}
            value={formatRating(profile.averageRating)}
            testID="public-profile-rating"
          />
          <StatRow
            label={t('profile.public.completedServices')}
            value={String(profile.completedServicesCount ?? 0)}
            testID="public-profile-completed-services"
          />
        </View>

        {/* Bio Section */}
        {profile.bio && (
          <View style={styles.card} testID="public-profile-bio">
            <Text style={styles.sectionTitle}>{t('profile.public.bio')}</Text>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        )}

        {/* Specialties Section */}
        {hasSpecialties && (
          <View style={styles.card} testID="public-profile-specialties">
            <Text style={styles.sectionTitle}>{t('profile.public.specialties')}</Text>
            <View style={styles.chipContainer}>
              {profile.specialties!.map((specialty) => (
                <SpecialtyChip key={specialty} label={specialty} />
              ))}
            </View>
          </View>
        )}

        {/* Work Zone Section */}
        {profile.workZoneLabel && (
          <View style={styles.card} testID="public-profile-work-zone">
            <StatRow
              label={t('profile.public.workZone')}
              value={profile.workZoneLabel}
              testID="public-profile-work-zone-value"
            />
          </View>
        )}

        {/* Portfolio Gallery (Read-Only) */}
        {hasPortfolio && (
          <View style={styles.card} testID="public-profile-portfolio">
            <Text style={styles.sectionTitle}>{t('profile.public.portfolio')}</Text>
            <FlatList
              data={portfolioPhotos}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <PortfolioItem photo={item} />}
              numColumns={PORTFOLIO_COLUMNS}
              scrollEnabled={false}
              columnWrapperStyle={styles.portfolioRow}
              testID="public-profile-portfolio-grid"
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
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
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZE.sm,
    color: theme.textSecondary,
  },
  errorText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: theme.danger,
    textAlign: 'center',
  },
  headerCard: {
    backgroundColor: theme.surface,
    borderRadius: SPACING.md,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    alignItems: 'center',
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: SPACING.md,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  photoContainer: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
  },
  photoPlaceholder: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: theme.onAccent,
  },
  displayName: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  businessName: {
    fontSize: FONT_SIZE.sm,
    color: theme.accent,
    marginTop: SPACING.sm / 2,
    textAlign: 'center',
  },
  memberSince: {
    fontSize: FONT_SIZE.xs,
    color: theme.textSecondary,
    marginTop: SPACING.sm,
  },
  kycBadge: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm / 2,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.surfaceElevated,
  },
  kycText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    color: theme.accent,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: SPACING.sm,
  },
  bioText: {
    fontSize: FONT_SIZE.sm,
    color: theme.textPrimary,
    lineHeight: FONT_SIZE.sm * 1.5,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm / 2,
  },
  chip: {
    backgroundColor: theme.background,
    borderRadius: SPACING.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm / 2,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  chipText: {
    fontSize: FONT_SIZE.xs,
    color: theme.accent,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm / 2,
  },
  statLabel: {
    fontSize: FONT_SIZE.sm,
    color: theme.textSecondary,
  },
  statValue: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  portfolioRow: {
    gap: PORTFOLIO_GAP,
    marginBottom: PORTFOLIO_GAP,
  },
  portfolioItem: {
    width: PORTFOLIO_ITEM_SIZE,
    height: PORTFOLIO_ITEM_SIZE,
    borderRadius: SPACING.sm,
    overflow: 'hidden',
    backgroundColor: theme.divider,
  },
  portfolioImage: {
    width: '100%',
    height: '100%',
  },
  portfolioPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.divider,
  },
}));

export default PublicProfileScreen;

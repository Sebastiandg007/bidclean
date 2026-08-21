/**
 * CleanerProfileCard — Cleaner-specific profile fields display card.
 *
 * Shows specialties (tags/chips), work zone label, availability summary,
 * bio preview, portfolio count, average rating (read-only),
 * completed services (read-only), and KYC badge indicator.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { CleanerProfile } from '../profile.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  divider: '#2B3A4A',
  chipBg: '#0B0C10',
  kycVerified: '#00F5D4',
  kycPending: '#C5C6C7',
} as const;

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
} as const;

const BIO_PREVIEW_LINES = 3;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CleanerProfileCardProps {
  cleaner: CleanerProfile;
  memberSince: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formats rating to one decimal place or shows placeholder */
function formatRating(rating: number | null): string {
  if (rating === null) return '—';
  return rating.toFixed(1);
}

/** Counts enabled days in availability schedule */
function countAvailableDays(availability: Record<string, unknown> | null): number {
  if (!availability) return 0;

  return Object.values(availability).filter(
    (day) => typeof day === 'object' && day !== null && (day as Record<string, unknown>).enabled === true,
  ).length;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface StatRowProps {
  label: string;
  value: string;
  testID?: string;
}

function StatRow({ label, value, testID }: StatRowProps): React.JSX.Element {
  return (
    <View style={styles.statRow} testID={testID}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

interface ChipProps {
  label: string;
}

function Chip({ label }: ChipProps): React.JSX.Element {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Card displaying Cleaner-specific profile fields.
 * All fields are read-only in this view (editing happens on EditProfileScreen).
 */
export function CleanerProfileCard({
  cleaner,
  memberSince,
}: CleanerProfileCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const availableDays = countAvailableDays(cleaner.availability);

  return (
    <View style={styles.container} testID="cleaner-profile-card">
      <View style={styles.titleRow}>
        <Text style={styles.title}>
          {t('profile.cleaner.title', { defaultValue: 'Cleaner Profile' })}
        </Text>

        {/* KYC Badge */}
        <View
          style={[styles.kycBadge, cleaner.kycBadge && styles.kycBadgeVerified]}
          testID="cleaner-kyc-badge"
        >
          <Text style={[styles.kycText, cleaner.kycBadge && styles.kycTextVerified]}>
            {cleaner.kycBadge
              ? t('profile.cleaner.kycVerified', { defaultValue: 'Verified' })
              : t('profile.cleaner.kycPending', { defaultValue: 'Unverified' })}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Specialties */}
      <Text style={styles.sectionLabel}>
        {t('profile.cleaner.specialties', { defaultValue: 'Specialties' })}
      </Text>
      <View style={styles.chipContainer} testID="cleaner-specialties">
        {cleaner.specialties.length > 0 ? (
          cleaner.specialties.map((specialty) => (
            <Chip key={specialty} label={specialty} />
          ))
        ) : (
          <Text style={styles.emptyText}>
            {t('profile.cleaner.noSpecialties', { defaultValue: 'No specialties added' })}
          </Text>
        )}
      </View>

      {/* Work Zone */}
      <StatRow
        label={t('profile.cleaner.workZone', { defaultValue: 'Work Zone' })}
        value={cleaner.workZoneLabel ?? t('profile.cleaner.notSet', { defaultValue: 'Not set' })}
        testID="cleaner-work-zone"
      />

      {/* Availability */}
      <StatRow
        label={t('profile.cleaner.availability', { defaultValue: 'Availability' })}
        value={t('profile.cleaner.availableDays', {
          defaultValue: `${availableDays} days/week`,
          count: availableDays,
        })}
        testID="cleaner-availability"
      />

      {/* Bio preview */}
      {cleaner.bio && (
        <View style={styles.bioSection} testID="cleaner-bio">
          <Text style={styles.sectionLabel}>
            {t('profile.cleaner.bio', { defaultValue: 'Bio' })}
          </Text>
          <Text style={styles.bioText} numberOfLines={BIO_PREVIEW_LINES}>
            {cleaner.bio}
          </Text>
        </View>
      )}

      {/* Portfolio */}
      <StatRow
        label={t('profile.cleaner.portfolio', { defaultValue: 'Portfolio Photos' })}
        value={String(cleaner.portfolioCount)}
        testID="cleaner-portfolio-count"
      />

      <View style={styles.divider} />

      {/* Read-only stats */}
      <StatRow
        label={t('profile.cleaner.rating', { defaultValue: 'Average Rating' })}
        value={formatRating(cleaner.averageRating)}
        testID="cleaner-rating"
      />

      <StatRow
        label={t('profile.cleaner.completedServices', { defaultValue: 'Completed Services' })}
        value={String(cleaner.completedServicesCount)}
        testID="cleaner-completed-services"
      />

      <StatRow
        label={t('profile.cleaner.memberSince', { defaultValue: 'Member Since' })}
        value={new Date(memberSince).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        })}
        testID="cleaner-member-since"
      />
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
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.accent,
  },
  kycBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm / 2,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.kycPending,
  },
  kycBadgeVerified: {
    borderColor: COLORS.kycVerified,
    backgroundColor: `${COLORS.kycVerified}15`,
  },
  kycText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    color: COLORS.kycPending,
  },
  kycTextVerified: {
    color: COLORS.kycVerified,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.divider,
    marginVertical: SPACING.sm,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm / 2,
    marginTop: SPACING.sm / 2,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm / 2,
    marginBottom: SPACING.sm,
  },
  chip: {
    backgroundColor: COLORS.chipBg,
    borderRadius: SPACING.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm / 2,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  chipText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.accent,
  },
  emptyText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  bioSection: {
    marginVertical: SPACING.sm / 2,
  },
  bioText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textPrimary,
    lineHeight: FONT_SIZE.sm * 1.4,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm / 2,
  },
  statLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  statValue: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});

export default CleanerProfileCard;

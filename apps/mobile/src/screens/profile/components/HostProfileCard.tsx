/**
 * HostProfileCard — Host-specific profile fields display card.
 *
 * Shows business name, properties count, payment methods count,
 * average rating (read-only), and completed services count (read-only).
 * The profile module NEVER stores payment data — only read-only aggregates.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../../theme';
import type { HostProfile } from '../profile.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface HostProfileCardProps {
  host: HostProfile;
  memberSince: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formats rating to one decimal place or shows placeholder */
function formatRating(rating: number | null): string {
  if (rating === null) return '—';
  return rating.toFixed(1);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Card displaying Host-specific profile fields.
 * All fields are read-only in this view (editing happens on EditProfileScreen).
 */
export function HostProfileCard({
  host,
  memberSince,
}: HostProfileCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <View style={styles.container} testID="host-profile-card">
      <Text style={styles.title}>
        {t('profile.host.title', { defaultValue: 'Host Profile' })}
      </Text>

      <View style={styles.divider} />

      <StatRow
        label={t('profile.host.businessName', { defaultValue: 'Business Name' })}
        value={host.businessName ?? t('profile.host.notSet', { defaultValue: 'Not set' })}
        testID="host-business-name"
      />

      <StatRow
        label={t('profile.host.properties', { defaultValue: 'Properties' })}
        value={String(host.propertiesCount)}
        testID="host-properties-count"
      />

      <StatRow
        label={t('profile.host.paymentMethods', { defaultValue: 'Payment Methods' })}
        value={String(host.paymentMethodsCount)}
        testID="host-payment-methods"
      />

      <View style={styles.divider} />

      <StatRow
        label={t('profile.host.rating', { defaultValue: 'Average Rating' })}
        value={formatRating(host.averageRating)}
        testID="host-rating"
      />

      <StatRow
        label={t('profile.host.completedServices', { defaultValue: 'Completed Services' })}
        value={String(host.completedServicesCount)}
        testID="host-completed-services"
      />

      <StatRow
        label={t('profile.host.memberSince', { defaultValue: 'Member Since' })}
        value={new Date(memberSince).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        })}
        testID="host-member-since"
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    backgroundColor: theme.surface,
    borderRadius: SPACING.md,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: theme.accent,
    marginBottom: SPACING.sm,
  },
  divider: {
    height: 1,
    backgroundColor: theme.divider,
    marginVertical: SPACING.sm,
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
}));

export default HostProfileCard;

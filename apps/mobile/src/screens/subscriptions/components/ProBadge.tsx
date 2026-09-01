/**
 * ProBadge — a small "PRO" badge shown when the user is PRO in a specific role.
 *
 * Gated per role from the server-authoritative view: the Cleaner view passes CLEANER (driven by
 * `cleaner_pro`), the Host view passes HOST (driven by `host_pro`). A user PRO in one role and
 * FREE in the other shows the badge only in the PRO role's view. Renders nothing when FREE.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSubscriptionStore } from '../useSubscription';
import { SubscriberRole, SubscriberTier } from '../subscriptions.types';

const COLORS = {
  accent: '#00F5D4',
  onAccent: '#0B0C10',
} as const;

export interface ProBadgeProps {
  /** The role whose PRO tier gates this badge. */
  role: SubscriberRole;
}

export function ProBadge({ role }: ProBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation('subscriptions');
  const serverView = useSubscriptionStore((s) => s.serverView);

  const isPro = serverView?.roleTiers[role] === SubscriberTier.PRO;
  if (!isPro) {
    return null;
  }

  return (
    <View style={styles.badge} testID="pro-badge">
      <Text style={styles.label}>{t('badge.pro')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accent,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  label: {
    color: COLORS.onAccent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

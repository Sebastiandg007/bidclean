/**
 * ProposalStatusBadge — small colored badge showing a proposal's status,
 * localized via i18n.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ProposalStatus } from '../negotiation.types';
import { makeStyles, useTheme } from '../../../theme';
import type { SemanticTokens } from '../../../theme';

const BADGE_RADIUS = 6;
const SPACING = { xs: 4, sm: 8 } as const;
const FONT_SIZE = { badge: 11 } as const;

/** Map a proposal status to the semantic token that best conveys its state. */
function statusColor(status: ProposalStatus, theme: SemanticTokens): string {
  switch (status) {
    case 'PENDING':
      return theme.warning;
    case 'ACCEPTED':
      return theme.success;
    case 'REJECTED':
      return theme.danger;
    case 'COUNTERED':
      return theme.accent;
    default:
      return theme.textMuted;
  }
}

export interface ProposalStatusBadgeProps {
  status: ProposalStatus;
}

export function ProposalStatusBadge({ status }: ProposalStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');
  const styles = useStyles();
  const { theme } = useTheme();

  return (
    <View
      style={[styles.badge, { backgroundColor: statusColor(status, theme) }]}
      testID={`proposal-status-${status}`}
    >
      <Text style={styles.text}>{t(`status.${status}`)}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BADGE_RADIUS,
  },
  text: {
    fontSize: FONT_SIZE.badge,
    fontWeight: '700',
    color: theme.onAccent,
  },
}));

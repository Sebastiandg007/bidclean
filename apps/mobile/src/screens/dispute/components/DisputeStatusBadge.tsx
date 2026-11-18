/**
 * DisputeStatusBadge — the dispute-state indicator (Spec 21).
 *
 * Sourced from the server-authoritative dispute `state`. Never exposes internal intent fields.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from '../dispute.constants';
import type { DisputeState } from '../dispute.types';

export interface DisputeStatusBadgeProps {
  readonly state: DisputeState;
}

/** Map the dispute state to its i18n label key. */
function resolveLabelKey(state: DisputeState): string {
  switch (state) {
    case 'OPEN':
      return DISPUTE_I18N_KEYS.STATE_OPEN;
    case 'UNDER_REVIEW':
      return DISPUTE_I18N_KEYS.STATE_UNDER_REVIEW;
    case 'RESOLVED':
      return DISPUTE_I18N_KEYS.STATE_RESOLVED;
    default:
      return DISPUTE_I18N_KEYS.STATE_EXPIRED;
  }
}

export function DisputeStatusBadge({ state }: DisputeStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation();
  const isTerminal = state === 'RESOLVED' || state === 'EXPIRED';
  return (
    <View style={styles.container} testID="dispute-status-badge">
      <Text style={[styles.text, isTerminal && styles.terminal]}>{t(resolveLabelKey(state))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: DISPUTE_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  text: {
    color: DISPUTE_COLORS.TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  terminal: {
    color: DISPUTE_COLORS.ACCENT,
  },
});

/**
 * OutcomeSummary — the resolved/expired dispute outcome + payment effect (Spec 21).
 *
 * Shows favor-cleaner / favor-host / partial (+ amount) and the resulting payment effect (released /
 * refunded / partially refunded), sourced from the server-authoritative dispute resolution. Never
 * exposes internal intent fields.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from '../dispute.constants';
import type { DisputeResolution } from '../dispute.types';

export interface OutcomeSummaryProps {
  readonly resolution: DisputeResolution;
  readonly resolutionRefundCents: number | null;
}

/** Map a resolution to its outcome + payment-effect i18n keys. */
function resolveKeys(resolution: DisputeResolution): { outcome: string; effect: string } {
  switch (resolution) {
    case 'FAVOR_CLEANER':
      return { outcome: DISPUTE_I18N_KEYS.OUTCOME_FAVOR_CLEANER, effect: DISPUTE_I18N_KEYS.EFFECT_RELEASED };
    case 'FAVOR_HOST':
      return { outcome: DISPUTE_I18N_KEYS.OUTCOME_FAVOR_HOST, effect: DISPUTE_I18N_KEYS.EFFECT_REFUNDED };
    default:
      return {
        outcome: DISPUTE_I18N_KEYS.OUTCOME_PARTIAL,
        effect: DISPUTE_I18N_KEYS.EFFECT_PARTIALLY_REFUNDED,
      };
  }
}

export function OutcomeSummary({
  resolution,
  resolutionRefundCents,
}: OutcomeSummaryProps): React.JSX.Element {
  const { t } = useTranslation();
  const keys = resolveKeys(resolution);
  const amount = resolutionRefundCents === null ? '' : ` (${(resolutionRefundCents / 100).toFixed(2)})`;
  return (
    <View style={styles.container} testID="dispute-outcome-summary">
      <Text style={styles.outcome}>{`${t(keys.outcome)}${amount}`}</Text>
      <Text style={styles.effect}>{t(keys.effect)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: DISPUTE_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  outcome: { color: DISPUTE_COLORS.ACCENT, fontSize: 16, fontWeight: '700' },
  effect: { color: DISPUTE_COLORS.TEXT_SECONDARY, fontSize: 14 },
});

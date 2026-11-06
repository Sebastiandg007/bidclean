/**
 * ReleaseStatusBadge — the Cleaner's release-status indicator (Spec 20).
 *
 * Sourced from the server-derived `releaseStatus` (+ the completion state for disputes): released /
 * pending payout / not triggered / disputed. It never exposes internal intent fields.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COMPLETION_COLORS, COMPLETION_I18N_KEYS } from '../completion.constants';
import type { CompletionState, ReleaseStatus } from '../completion.types';

export interface ReleaseStatusBadgeProps {
  readonly state: CompletionState;
  readonly releaseStatus: ReleaseStatus;
}

/** Map (state, releaseStatus) to the i18n label key + accent flag. */
function resolveLabelKey(state: CompletionState, releaseStatus: ReleaseStatus): string {
  if (state === 'DISPUTED') {
    return COMPLETION_I18N_KEYS.RELEASE_DISPUTED;
  }
  if (releaseStatus === 'ACCEPTED') {
    return COMPLETION_I18N_KEYS.RELEASE_RELEASED;
  }
  if (releaseStatus === 'PENDING') {
    return COMPLETION_I18N_KEYS.RELEASE_PENDING_PAYOUT;
  }
  return COMPLETION_I18N_KEYS.RELEASE_NOT_TRIGGERED;
}

export function ReleaseStatusBadge({
  state,
  releaseStatus,
}: ReleaseStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation();
  const isReleased = state !== 'DISPUTED' && releaseStatus === 'ACCEPTED';
  return (
    <View style={styles.container} testID="release-status-badge">
      <Text style={[styles.text, isReleased && styles.released]}>
        {t(resolveLabelKey(state, releaseStatus))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COMPLETION_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  text: {
    color: COMPLETION_COLORS.TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  released: {
    color: COMPLETION_COLORS.ACCENT,
  },
});

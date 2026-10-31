/**
 * AutoReleaseCountdown — a display of the durable server deadline (Spec 20).
 *
 * Renders the remaining time until auto-release, or a "releasing" label once expired. This is a
 * display of the server-authoritative deadline, never an authoritative client timer.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COMPLETION_COLORS, COMPLETION_I18N_KEYS } from '../completion.constants';

export interface AutoReleaseCountdownProps {
  readonly remainingMs: number;
  readonly expired: boolean;
}

/** Format a remaining-ms span as `HH:MM:SS`. */
function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function AutoReleaseCountdown({
  remainingMs,
  expired,
}: AutoReleaseCountdownProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="auto-release-countdown">
      <Text style={styles.label}>{t(COMPLETION_I18N_KEYS.COUNTDOWN_LABEL)}</Text>
      <Text style={styles.value} testID="auto-release-countdown-value">
        {expired ? t(COMPLETION_I18N_KEYS.COUNTDOWN_EXPIRED) : formatRemaining(remainingMs)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COMPLETION_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  label: {
    color: COMPLETION_COLORS.TEXT_SECONDARY,
    fontSize: 13,
  },
  value: {
    color: COMPLETION_COLORS.ACCENT,
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

/**
 * ProgressBar — a simple X/Y checklist progress indicator (Spec 19).
 *
 * Pure presentational. Renders a filled track proportional to completed/total and the numeric
 * label; dark BidClean tokens. A zero-task run shows a full/complete bar (nothing to do).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CHECKLIST_COLORS } from '../checklist.constants';

export interface ProgressBarProps {
  readonly completed: number;
  readonly total: number;
}

/** Fraction complete in [0, 1]; a zero-task run is fully complete. */
function fraction(completed: number, total: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, completed / total));
}

export function ProgressBar({ completed, total }: ProgressBarProps): React.JSX.Element {
  const pct = Math.round(fraction(completed, total) * 100);
  return (
    <View style={styles.container} testID="checklist-progress-bar">
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.label} testID="checklist-progress-label">
        {completed}/{total}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: CHECKLIST_COLORS.CARD,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: CHECKLIST_COLORS.ACCENT,
  },
  label: {
    color: CHECKLIST_COLORS.TEXT,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
});

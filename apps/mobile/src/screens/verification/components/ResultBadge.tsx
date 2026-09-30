/**
 * ResultBadge — the Host-facing verification result indicator (Spec 18).
 *
 * Renders exactly one derived status (recording / checking / verified / needs-review / unavailable)
 * — NEVER the raw footage or the raw score (REQ-VV15). The label is passed in already-translated
 * (the screen owns i18n). Colour cues: accent for verified, amber for needs-review, muted for the
 * rest. Non-accusatory by design; the dispute path is a separate affordance on the screen.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { VERIFICATION_COLORS } from '../verification.constants';
import type { DisplayStatus } from '../verification.types';

export interface ResultBadgeProps {
  readonly status: DisplayStatus;
  readonly label: string;
}

/** Resolve the badge colour for a display status (no raw score is ever shown). */
function colorForStatus(status: DisplayStatus): string {
  if (status === 'verified') {
    return VERIFICATION_COLORS.ACCENT;
  }
  if (status === 'needs-review') {
    return '#F6C453';
  }
  return 'rgba(255,255,255,0.6)';
}

export function ResultBadge(props: ResultBadgeProps): React.JSX.Element {
  const { status, label } = props;
  return (
    <View style={styles.badge} testID={`verification-badge-${status}`}>
      <View style={[styles.dot, { backgroundColor: colorForStatus(status) }]} />
      <Text style={[styles.label, { color: colorForStatus(status) }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VERIFICATION_COLORS.CARD,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  label: { fontSize: 15, fontWeight: '600' },
});

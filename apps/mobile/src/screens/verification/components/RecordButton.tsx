/**
 * RecordButton — the Cleaner's record/stop CTA for the arrival clip (Spec 18).
 *
 * A single toggle that reads recording state + elapsed time and calls back to start/stop. Uses the
 * BidClean accent for the record affordance. Copy is passed in as already-translated labels (the
 * screen owns i18n). Disabled when camera/mic permission is not granted.
 */

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { VERIFICATION_COLORS } from '../verification.constants';

export interface RecordButtonProps {
  readonly isRecording: boolean;
  readonly disabled: boolean;
  readonly recordLabel: string;
  readonly stopLabel: string;
  readonly onPress: () => void;
}

export function RecordButton(props: RecordButtonProps): React.JSX.Element {
  const { isRecording, disabled, recordLabel, stopLabel, onPress } = props;
  return (
    <Pressable
      testID="verification-record-button"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, isRecording ? styles.recording : styles.idle, disabled && styles.disabled]}
    >
      <Text style={styles.label}>{isRecording ? stopLabel : recordLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 32,
    alignItems: 'center',
  },
  idle: { backgroundColor: VERIFICATION_COLORS.ACCENT },
  recording: { backgroundColor: '#FF5A5F' },
  disabled: { opacity: 0.4 },
  label: { color: VERIFICATION_COLORS.BACKGROUND, fontSize: 16, fontWeight: '700' },
});

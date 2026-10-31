/**
 * RecordButton — the Cleaner's record/stop CTA for the arrival clip (Spec 18).
 *
 * A single toggle that reads recording state + elapsed time and calls back to start/stop. Uses the
 * BidClean accent for the record affordance. Copy is passed in as already-translated labels (the
 * screen owns i18n). Disabled when camera/mic permission is not granted.
 */

import React from 'react';
import { Pressable, Text } from 'react-native';

import { makeStyles } from '../../../theme';

export interface RecordButtonProps {
  readonly isRecording: boolean;
  readonly disabled: boolean;
  readonly recordLabel: string;
  readonly stopLabel: string;
  readonly onPress: () => void;
}

export function RecordButton(props: RecordButtonProps): React.JSX.Element {
  const { isRecording, disabled, recordLabel, stopLabel, onPress } = props;
  const styles = useStyles();
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

const useStyles = makeStyles((theme) => ({
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 32,
    alignItems: 'center',
  },
  idle: { backgroundColor: theme.accent },
  recording: { backgroundColor: theme.danger },
  disabled: { opacity: 0.4 },
  label: { color: theme.onAccent, fontSize: 16, fontWeight: '700' },
}));

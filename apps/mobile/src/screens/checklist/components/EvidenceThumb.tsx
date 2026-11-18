/**
 * EvidenceThumb — a tappable evidence photo reference (Spec 19).
 *
 * Holds only a photo id + kind (never an object key or URL). Tapping it asks the parent to fetch a
 * fresh participant-gated playback URL on demand (Host or Cleaner may view). Dark BidClean tokens.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { CHECKLIST_COLORS } from '../checklist.constants';
import type { TaskPhotoRef } from '../checklist.types';

export interface EvidenceThumbProps {
  readonly photo: TaskPhotoRef;
  readonly onView: (photoId: string) => void;
}

export function EvidenceThumb({ photo, onView }: EvidenceThumbProps): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.thumb}
      onPress={() => onView(photo.id)}
      testID={`checklist-evidence-${photo.id}`}
      accessibilityRole="button"
    >
      <Text style={styles.kind}>{photo.kind}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: CHECKLIST_COLORS.CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kind: {
    color: CHECKLIST_COLORS.TEXT_SECONDARY,
    fontSize: 10,
    fontWeight: '600',
  },
});

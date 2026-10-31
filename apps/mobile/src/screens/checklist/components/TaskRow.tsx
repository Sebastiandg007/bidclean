/**
 * TaskRow — one checklist task row (Spec 19).
 *
 * Cleaner mode: a done toggle + an "add photo" affordance. Host mode: read-only (no toggle, no
 * capture). Both modes render attached evidence thumbnails (participant-gated view on tap). Pure
 * presentational — all actions are delegated to the parent. Dark BidClean tokens.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CHECKLIST_COLORS, CHECKLIST_I18N_KEYS } from '../checklist.constants';
import { EvidenceThumb } from './EvidenceThumb';
import type { ChecklistTask } from '../checklist.types';

export interface TaskRowProps {
  readonly task: ChecklistTask;
  readonly canMutate: boolean;
  readonly onToggle: (taskId: string, done: boolean) => void;
  readonly onAddPhoto: (taskId: string) => void;
  readonly onViewPhoto: (photoId: string) => void;
}

export function TaskRow({
  task,
  canMutate,
  onToggle,
  onAddPhoto,
  onViewPhoto,
}: TaskRowProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID={`checklist-task-${task.id}`}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.checkbox, task.isDone && styles.checkboxDone]}
          disabled={!canMutate}
          onPress={() => onToggle(task.id, !task.isDone)}
          testID={`checklist-task-toggle-${task.id}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.isDone, disabled: !canMutate }}
        >
          {task.isDone && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>
        <Text style={[styles.text, task.isDone && styles.textDone]}>{task.taskText}</Text>
      </View>

      <View style={styles.evidence}>
        {task.photos.map((photo) => (
          <EvidenceThumb key={photo.id} photo={photo} onView={onViewPhoto} />
        ))}
        {canMutate && (
          <TouchableOpacity
            style={styles.addPhoto}
            onPress={() => onAddPhoto(task.id)}
            testID={`checklist-task-add-photo-${task.id}`}
            accessibilityRole="button"
          >
            <Text style={styles.addPhotoText}>{t(CHECKLIST_I18N_KEYS.ADD_PHOTO)}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: CHECKLIST_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: CHECKLIST_COLORS.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: CHECKLIST_COLORS.ACCENT,
  },
  checkmark: {
    color: CHECKLIST_COLORS.BACKGROUND,
    fontSize: 16,
    fontWeight: '700',
  },
  text: {
    flex: 1,
    color: CHECKLIST_COLORS.TEXT,
    fontSize: 15,
  },
  textDone: {
    color: CHECKLIST_COLORS.TEXT_SECONDARY,
    textDecorationLine: 'line-through',
  },
  evidence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addPhoto: {
    height: 56,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CHECKLIST_COLORS.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoText: {
    color: CHECKLIST_COLORS.ACCENT,
    fontSize: 12,
    fontWeight: '600',
  },
});

/**
 * ChecklistScreen (Cleaner) — the snapshotted checklist with per-task toggles + evidence capture
 * (Spec 19).
 *
 * The Cleaner works the checklist while the session is IN_PROGRESS: toggling tasks and attaching
 * before/after photos (request → PUT to MinIO → finalize, composed in the store). A clear finalize
 * affordance surfaces any unmet precondition; on success the run reflects COMPLETED and hands off to
 * the completion flow (Spec 20). Camera-permission denial degrades gracefully (never crashes, never
 * hard-blocks photo-optional tasks). Dark BidClean tokens; all copy via i18n.
 */

import React, { useCallback, useEffect } from 'react';
import { ScrollView, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CHECKLIST_I18N_KEYS } from './checklist.constants';
import { makeStyles } from '../../theme';
import { ProgressBar } from './components/ProgressBar';
import { TaskRow } from './components/TaskRow';
import { getPlaybackUrlRequest } from './checklist.api';
import { useChecklistStore } from './checklist.store';
import { usePhotoCapture } from './usePhotoCapture';

export interface ChecklistScreenProps {
  route: { params: { sessionId: string } };
  navigation: { goBack: () => void };
}

export function ChecklistScreen({ route }: ChecklistScreenProps): React.JSX.Element {
  const { sessionId } = route.params;
  const { t } = useTranslation();
  const styles = useStyles();

  const run = useChecklistStore((store) => store.run);
  const error = useChecklistStore((store) => store.error);
  const isFinalizing = useChecklistStore((store) => store.isFinalizing);
  const loadChecklist = useChecklistStore((store) => store.loadChecklist);
  const toggleTask = useChecklistStore((store) => store.toggleTask);
  const uploadPhoto = useChecklistStore((store) => store.uploadPhoto);
  const finalize = useChecklistStore((store) => store.finalize);

  const { capture, errorKey: captureErrorKey } = usePhotoCapture();

  useEffect(() => {
    void loadChecklist(sessionId);
  }, [sessionId, loadChecklist]);

  const onToggle = useCallback(
    (taskId: string, done: boolean) => {
      void toggleTask(sessionId, taskId, done);
    },
    [sessionId, toggleTask],
  );

  const onAddPhoto = useCallback(
    async (taskId: string) => {
      const result = await capture();
      if (result.status === 'captured') {
        await uploadPhoto(sessionId, taskId, result.photo, 'AFTER');
      }
    },
    [sessionId, capture, uploadPhoto],
  );

  const onViewPhoto = useCallback(
    async (photoId: string) => {
      await getPlaybackUrlRequest(sessionId, photoId);
    },
    [sessionId],
  );

  const isActive = run?.state === 'ACTIVE';

  return (
    <SafeAreaView style={styles.screen} testID="checklist-screen">
      <Text style={styles.title}>{t(CHECKLIST_I18N_KEYS.CLEANER_TITLE)}</Text>
      {run && <ProgressBar completed={run.completedTasks} total={run.totalTasks} />}

      {captureErrorKey !== null && (
        <Text style={styles.permission} testID="checklist-capture-error">
          {t(captureErrorKey)}
        </Text>
      )}
      {error !== null && (
        <Text style={styles.error} testID="checklist-error">
          {t(error)}
        </Text>
      )}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {run && run.tasks.length === 0 && (
          <Text style={styles.empty} testID="checklist-empty">
            {t(CHECKLIST_I18N_KEYS.EMPTY)}
          </Text>
        )}
        {run?.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            canMutate={isActive}
            onToggle={onToggle}
            onAddPhoto={(taskId) => void onAddPhoto(taskId)}
            onViewPhoto={(photoId) => void onViewPhoto(photoId)}
          />
        ))}
      </ScrollView>

      {run?.state === 'COMPLETED' ? (
        <Text style={styles.completed} testID="checklist-completed">
          {t(CHECKLIST_I18N_KEYS.COMPLETED)}
        </Text>
      ) : (
        <TouchableOpacity
          style={[styles.finalize, (!isActive || isFinalizing) && styles.finalizeDisabled]}
          disabled={!isActive || isFinalizing}
          onPress={() => void finalize(sessionId)}
          testID="checklist-finalize"
          accessibilityRole="button"
        >
          <Text style={styles.finalizeText}>{t(CHECKLIST_I18N_KEYS.FINALIZE)}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
    padding: 20,
    gap: 16,
  },
  title: {
    color: theme.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  empty: {
    color: theme.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 24,
  },
  permission: {
    color: theme.textSecondary,
    fontSize: 13,
  },
  error: {
    color: theme.danger,
    fontSize: 13,
  },
  finalize: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  finalizeDisabled: {
    opacity: 0.4,
  },
  finalizeText: {
    color: theme.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  completed: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
}));

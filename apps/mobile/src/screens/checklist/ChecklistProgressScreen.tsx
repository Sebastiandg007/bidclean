/**
 * ChecklistProgressScreen (Host) — read-only live-ish progress + evidence viewing (Spec 19).
 *
 * The Host observes X/Y task progress (best-effort realtime, authoritative via `GET`) and may view
 * attached evidence photos (participant-gated, session-scoped playback fetched on demand). The Host
 * never mutates task state — the rows are read-only. Dark BidClean tokens; all copy via i18n.
 */

import React, { useCallback, useEffect } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CHECKLIST_I18N_KEYS } from './checklist.constants';
import { makeStyles } from '../../theme';
import { ProgressBar } from './components/ProgressBar';
import { TaskRow } from './components/TaskRow';
import { getPlaybackUrlRequest } from './checklist.api';
import { useChecklistStore } from './checklist.store';

export interface ChecklistProgressScreenProps {
  route: { params: { sessionId: string } };
  navigation: { goBack: () => void };
}

export function ChecklistProgressScreen({
  route,
}: ChecklistProgressScreenProps): React.JSX.Element {
  const { sessionId } = route.params;
  const { t } = useTranslation();
  const styles = useStyles();

  const run = useChecklistStore((store) => store.run);
  const error = useChecklistStore((store) => store.error);
  const loadChecklist = useChecklistStore((store) => store.loadChecklist);

  useEffect(() => {
    void loadChecklist(sessionId);
  }, [sessionId, loadChecklist]);

  const onViewPhoto = useCallback(
    async (photoId: string) => {
      await getPlaybackUrlRequest(sessionId, photoId);
    },
    [sessionId],
  );

  const noop = useCallback(() => undefined, []);

  return (
    <SafeAreaView style={styles.screen} testID="checklist-progress-screen">
      <Text style={styles.title}>{t(CHECKLIST_I18N_KEYS.HOST_TITLE)}</Text>
      {run && <ProgressBar completed={run.completedTasks} total={run.totalTasks} />}

      {error !== null && (
        <Text style={styles.error} testID="checklist-progress-error">
          {t(error)}
        </Text>
      )}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {run && run.tasks.length === 0 && (
          <Text style={styles.empty} testID="checklist-progress-empty">
            {t(CHECKLIST_I18N_KEYS.EMPTY)}
          </Text>
        )}
        {run?.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            canMutate={false}
            onToggle={noop}
            onAddPhoto={noop}
            onViewPhoto={(photoId) => void onViewPhoto(photoId)}
          />
        ))}
      </ScrollView>
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
  error: {
    color: theme.danger,
    fontSize: 13,
  },
}));

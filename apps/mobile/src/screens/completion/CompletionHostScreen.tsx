/**
 * CompletionHostScreen (Host) — confirm / dispute + auto-release countdown + rating (Spec 20).
 *
 * The Host confirms satisfaction (→ CONFIRMED, prompts a rating), opens a dispute (→ DISPUTED,
 * clearly indicating auto-release is paused), or does nothing (→ AUTO_RELEASED after the deadline,
 * reconciled via `GET`). The countdown is a display of the durable server deadline (not an
 * authoritative client timer). Dark BidClean tokens; all copy via i18n.
 */

import React, { useCallback, useEffect } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AutoReleaseCountdown } from './components/AutoReleaseCountdown';
import { ConfirmDisputeActions } from './components/ConfirmDisputeActions';
import { RatingSheet } from './components/RatingSheet';
import { COMPLETION_COLORS, COMPLETION_I18N_KEYS } from './completion.constants';
import { useCompletionStore } from './completion.store';
import { useAutoReleaseCountdown } from './useAutoReleaseCountdown';

export interface CompletionHostScreenProps {
  route: { params: { completionId: string } };
  navigation: { goBack: () => void };
}

export function CompletionHostScreen({ route }: CompletionHostScreenProps): React.JSX.Element {
  const { completionId } = route.params;
  const { t } = useTranslation();

  const completion = useCompletionStore((store) => store.completion);
  const error = useCompletionStore((store) => store.error);
  const isSubmitting = useCompletionStore((store) => store.isSubmitting);
  const loadCompletion = useCompletionStore((store) => store.loadCompletion);
  const confirm = useCompletionStore((store) => store.confirm);
  const dispute = useCompletionStore((store) => store.dispute);
  const submitRating = useCompletionStore((store) => store.submitRating);
  const reconcile = useCompletionStore((store) => store.reconcile);

  useEffect(() => {
    void loadCompletion(completionId);
  }, [completionId, loadCompletion]);

  const onExpire = useCallback(() => {
    void reconcile(completionId);
  }, [completionId, reconcile]);

  const { remainingMs, expired } = useAutoReleaseCountdown(
    completion?.autoReleaseDeadline ?? null,
    onExpire,
  );

  const isAwaiting = completion?.state === 'AWAITING_CONFIRMATION';
  const isDisputed = completion?.state === 'DISPUTED';
  const isReleased = completion?.state === 'CONFIRMED' || completion?.state === 'AUTO_RELEASED';

  return (
    <SafeAreaView style={styles.screen} testID="completion-host-screen">
      <Text style={styles.title}>{t(COMPLETION_I18N_KEYS.HOST_TITLE)}</Text>

      {error !== null && (
        <Text style={styles.error} testID="completion-host-error">
          {t(error)}
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {isAwaiting && (
          <>
            <AutoReleaseCountdown remainingMs={remainingMs} expired={expired} />
            <ConfirmDisputeActions
              disabled={isSubmitting}
              onConfirm={() => void confirm(completionId)}
              onDispute={() => void dispute(completionId)}
            />
          </>
        )}

        {isDisputed && (
          <Text style={styles.paused} testID="completion-host-paused">
            {t(COMPLETION_I18N_KEYS.DISPUTE_PAUSED)}
          </Text>
        )}

        {isReleased && (
          <RatingSheet
            alreadyRated={completion?.ratingStatus.hostRated ?? false}
            disabled={isSubmitting}
            onSubmit={(stars, comment) => void submitRating(completionId, stars, comment)}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COMPLETION_COLORS.BACKGROUND,
    padding: 20,
    gap: 16,
  },
  title: {
    color: COMPLETION_COLORS.TEXT,
    fontSize: 24,
    fontWeight: '700',
  },
  content: {
    gap: 16,
    paddingVertical: 8,
  },
  paused: {
    color: COMPLETION_COLORS.TEXT_SECONDARY,
    fontSize: 15,
  },
  error: {
    color: COMPLETION_COLORS.DANGER,
    fontSize: 13,
  },
});

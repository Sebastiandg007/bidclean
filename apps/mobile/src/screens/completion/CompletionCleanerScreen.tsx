/**
 * CompletionCleanerScreen (Cleaner) — release status + rating (Spec 20).
 *
 * The Cleaner sees the release status (released / pending payout / disputed) sourced from the
 * server-derived `releaseStatus`, so a CONFIRMED completion whose payout is still settling reads
 * "pending payout" rather than an error. Prompts for a rating once released. Dark BidClean tokens;
 * all copy via i18n.
 */

import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { RatingSheet } from './components/RatingSheet';
import { ReleaseStatusBadge } from './components/ReleaseStatusBadge';
import { COMPLETION_COLORS, COMPLETION_I18N_KEYS } from './completion.constants';
import { useCompletionStore } from './completion.store';

export interface CompletionCleanerScreenProps {
  route: { params: { completionId: string } };
  navigation: { goBack: () => void };
}

export function CompletionCleanerScreen({
  route,
}: CompletionCleanerScreenProps): React.JSX.Element {
  const { completionId } = route.params;
  const { t } = useTranslation();

  const completion = useCompletionStore((store) => store.completion);
  const error = useCompletionStore((store) => store.error);
  const isSubmitting = useCompletionStore((store) => store.isSubmitting);
  const loadCompletion = useCompletionStore((store) => store.loadCompletion);
  const submitRating = useCompletionStore((store) => store.submitRating);

  useEffect(() => {
    void loadCompletion(completionId);
  }, [completionId, loadCompletion]);

  const isReleased = completion?.state === 'CONFIRMED' || completion?.state === 'AUTO_RELEASED';

  return (
    <SafeAreaView style={styles.screen} testID="completion-cleaner-screen">
      <Text style={styles.title}>{t(COMPLETION_I18N_KEYS.CLEANER_TITLE)}</Text>

      {error !== null && (
        <Text style={styles.error} testID="completion-cleaner-error">
          {t(error)}
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {completion && (
          <ReleaseStatusBadge state={completion.state} releaseStatus={completion.releaseStatus} />
        )}

        {isReleased && (
          <RatingSheet
            alreadyRated={completion?.ratingStatus.cleanerRated ?? false}
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
  error: {
    color: COMPLETION_COLORS.DANGER,
    fontSize: 13,
  },
});

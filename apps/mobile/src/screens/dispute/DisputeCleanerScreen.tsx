/**
 * DisputeCleanerScreen (Cleaner) — counter-evidence + auto-release-paused indicator + outcome
 * (Spec 21).
 *
 * The Cleaner sees the dispute state, adds counter-evidence (a photo or a note) within the window, an
 * explicit "auto-release paused" indicator while the dispute is active, and the outcome + payment
 * effect once resolved. Dark BidClean tokens; all copy via i18n.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { DisputeStatusBadge } from './components/DisputeStatusBadge';
import { EvidenceUploader } from './components/EvidenceUploader';
import { OutcomeSummary } from './components/OutcomeSummary';
import { EvidenceGallery } from './EvidenceGallery';
import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from './dispute.constants';
import { useDisputeStore } from './dispute.store';

export interface DisputeCleanerScreenProps {
  route: { params: { disputeId: string } };
  navigation: { goBack: () => void };
}

export function DisputeCleanerScreen({ route }: DisputeCleanerScreenProps): React.JSX.Element {
  const { disputeId } = route.params;
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  const dispute = useDisputeStore((store) => store.dispute);
  const error = useDisputeStore((store) => store.error);
  const isSubmitting = useDisputeStore((store) => store.isSubmitting);
  const loadDispute = useDisputeStore((store) => store.loadDispute);
  const addStructuredEvidence = useDisputeStore((store) => store.addStructuredEvidence);
  const reconcile = useDisputeStore((store) => store.reconcile);

  useEffect(() => {
    void loadDispute(disputeId);
  }, [disputeId, loadDispute]);

  const submitNote = useCallback(() => {
    if (note.trim().length === 0) {
      return;
    }
    void addStructuredEvidence(disputeId, 'NOTE', note.trim());
    setNote('');
  }, [addStructuredEvidence, disputeId, note]);

  const isActive = dispute?.state === 'OPEN' || dispute?.state === 'UNDER_REVIEW';
  const isTerminal = dispute?.state === 'RESOLVED' || dispute?.state === 'EXPIRED';

  return (
    <SafeAreaView style={styles.screen} testID="dispute-cleaner-screen">
      <Text style={styles.title}>{t(DISPUTE_I18N_KEYS.CLEANER_TITLE)}</Text>

      {error !== null && (
        <Text style={styles.error} testID="dispute-cleaner-error">
          {t(error)}
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {dispute !== null && <DisputeStatusBadge state={dispute.state} />}

        {isActive && (
          <>
            <Text style={styles.paused} testID="dispute-cleaner-paused">
              {t(DISPUTE_I18N_KEYS.AUTO_RELEASE_PAUSED)}
            </Text>
            <TextInput
              style={styles.input}
              testID="dispute-cleaner-note"
              placeholder={t(DISPUTE_I18N_KEYS.ADD_NOTE)}
              placeholderTextColor={DISPUTE_COLORS.TEXT_SECONDARY}
              value={note}
              onChangeText={setNote}
              multiline
            />
            <TouchableOpacity
              testID="dispute-cleaner-submit-note"
              style={[styles.submit, isSubmitting && styles.disabled]}
              disabled={isSubmitting}
              onPress={submitNote}
            >
              <Text style={styles.submitText}>{t(DISPUTE_I18N_KEYS.SUBMIT_EVIDENCE)}</Text>
            </TouchableOpacity>
            <EvidenceUploader
              disputeId={disputeId}
              disabled={isSubmitting}
              onUploaded={() => void reconcile(disputeId)}
            />
          </>
        )}

        {dispute !== null && (
          <EvidenceGallery disputeId={disputeId} evidence={dispute.evidence} />
        )}

        {isTerminal && dispute?.resolution !== null && dispute !== null && (
          <OutcomeSummary
            resolution={dispute.resolution}
            resolutionRefundCents={dispute.resolutionRefundCents}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DISPUTE_COLORS.BACKGROUND,
    padding: 20,
    gap: 16,
  },
  title: { color: DISPUTE_COLORS.TEXT, fontSize: 24, fontWeight: '700' },
  content: { gap: 16, paddingVertical: 8 },
  paused: { color: DISPUTE_COLORS.TEXT_SECONDARY, fontSize: 15 },
  input: {
    backgroundColor: DISPUTE_COLORS.CARD,
    borderRadius: 12,
    color: DISPUTE_COLORS.TEXT,
    minHeight: 80,
    padding: 12,
    textAlignVertical: 'top',
  },
  submit: {
    backgroundColor: DISPUTE_COLORS.ACCENT,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  submitText: { color: DISPUTE_COLORS.BACKGROUND, fontSize: 15, fontWeight: '700' },
  error: { color: DISPUTE_COLORS.DANGER, fontSize: 13 },
});

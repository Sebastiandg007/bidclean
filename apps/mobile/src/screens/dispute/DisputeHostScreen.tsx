/**
 * DisputeHostScreen (Host) — reason + evidence + resolution countdown + outcome (Spec 21).
 *
 * The Host starts a dispute via the Spec 20 completion flow (reason + optional text + grant-gated
 * photos are gathered here; the case is created by the routing consumer, not a direct POST). The
 * screen reflects OPEN with a visible resolution deadline (a display of the durable server value),
 * lets the Host supplement evidence, and shows the outcome once resolved. Dark BidClean tokens; all
 * copy via i18n.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { DisputeStatusBadge } from './components/DisputeStatusBadge';
import { EvidenceUploader } from './components/EvidenceUploader';
import { OutcomeSummary } from './components/OutcomeSummary';
import { ReasonPicker } from './components/ReasonPicker';
import { EvidenceGallery } from './EvidenceGallery';
import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from './dispute.constants';
import { useDisputeStore } from './dispute.store';
import { useResolutionCountdown } from './useResolutionCountdown';

export interface DisputeHostScreenProps {
  route: { params: { disputeId: string; reasonCodes?: readonly string[] } };
  navigation: { goBack: () => void };
}

export function DisputeHostScreen({ route }: DisputeHostScreenProps): React.JSX.Element {
  const { disputeId, reasonCodes = [] } = route.params;
  const { t } = useTranslation();
  const [reason, setReason] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');

  const dispute = useDisputeStore((store) => store.dispute);
  const error = useDisputeStore((store) => store.error);
  const isSubmitting = useDisputeStore((store) => store.isSubmitting);
  const loadDispute = useDisputeStore((store) => store.loadDispute);
  const reconcile = useDisputeStore((store) => store.reconcile);

  useEffect(() => {
    void loadDispute(disputeId);
  }, [disputeId, loadDispute]);

  const onExpire = useCallback(() => {
    void reconcile(disputeId);
  }, [disputeId, reconcile]);

  const { remainingMs, expired } = useResolutionCountdown(
    dispute?.resolutionDeadline ?? null,
    onExpire,
  );

  const isActive = dispute?.state === 'OPEN' || dispute?.state === 'UNDER_REVIEW';
  const isTerminal = dispute?.state === 'RESOLVED' || dispute?.state === 'EXPIRED';

  return (
    <SafeAreaView style={styles.screen} testID="dispute-host-screen">
      <Text style={styles.title}>{t(DISPUTE_I18N_KEYS.HOST_TITLE)}</Text>

      {error !== null && (
        <Text style={styles.error} testID="dispute-host-error">
          {t(error)}
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {dispute !== null && <DisputeStatusBadge state={dispute.state} />}

        {isActive && (
          <>
            <Text style={styles.countdown} testID="dispute-host-countdown">
              {expired
                ? t(DISPUTE_I18N_KEYS.COUNTDOWN_EXPIRED)
                : `${t(DISPUTE_I18N_KEYS.COUNTDOWN_LABEL)} ${Math.ceil(remainingMs / 1000)}s`}
            </Text>
            <ReasonPicker
              reasonCodes={reasonCodes}
              selected={reason}
              text={reasonText}
              onSelect={setReason}
              onChangeText={setReasonText}
            />
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
  countdown: { color: DISPUTE_COLORS.TEXT_SECONDARY, fontSize: 15 },
  error: { color: DISPUTE_COLORS.DANGER, fontSize: 13 },
});

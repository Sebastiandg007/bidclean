/**
 * ArrivalVerificationIndicator (Host) — the on-arrival verification result indicator (Spec 18).
 *
 * Shows a single derived status (recording / checking / verified / needs-review / unavailable) via
 * `ResultBadge` — NEVER the raw footage and NEVER the raw score. A `needs-review` result presents a
 * calm path toward a dispute (Spec 21), not an accusation or an auto-cancel. It never blocks the
 * Host from proceeding. All copy comes from i18n; dark BidClean tokens.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ResultBadge } from './components/ResultBadge';
import { VERIFICATION_COLORS, VERIFICATION_I18N_KEYS } from './verification.constants';
import { useVerificationStore } from './verification.store';
import type { DisplayStatus } from './verification.types';

export interface ArrivalVerificationIndicatorProps {
  route: { params: { verificationId: string } };
  navigation: { goBack: () => void };
}

/** Map a display status to its i18n status-label key. */
function statusLabelKey(status: DisplayStatus): string {
  switch (status) {
    case 'recording':
      return VERIFICATION_I18N_KEYS.STATUS_RECORDING;
    case 'checking':
      return VERIFICATION_I18N_KEYS.STATUS_CHECKING;
    case 'verified':
      return VERIFICATION_I18N_KEYS.STATUS_VERIFIED;
    case 'needs-review':
      return VERIFICATION_I18N_KEYS.STATUS_NEEDS_REVIEW;
    default:
      return VERIFICATION_I18N_KEYS.STATUS_UNAVAILABLE;
  }
}

export function ArrivalVerificationIndicator(
  props: ArrivalVerificationIndicatorProps,
): React.JSX.Element {
  const { verificationId } = props.route.params;
  const { t } = useTranslation();

  const load = useVerificationStore((store) => store.load);
  const displayStatus = useVerificationStore((store) => store.displayStatus);
  const verification = useVerificationStore((store) => store.verification);

  useEffect(() => {
    void load(verificationId);
  }, [verificationId, load]);

  const status: DisplayStatus = displayStatus() ?? 'checking';

  return (
    <SafeAreaView style={styles.screen} testID="verification-host-screen">
      <Text style={styles.title}>{t(VERIFICATION_I18N_KEYS.HOST_TITLE)}</Text>
      <ResultBadge status={status} label={t(statusLabelKey(status))} />

      {status === 'needs-review' && verification !== null && (
        <View style={styles.reviewBlock} testID="verification-needs-review">
          <Text style={styles.reviewHint}>{t(VERIFICATION_I18N_KEYS.NEEDS_REVIEW_HINT)}</Text>
          <Text style={styles.disputePath} testID="verification-dispute-path">
            {t(VERIFICATION_I18N_KEYS.DISPUTE_PATH)}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: VERIFICATION_COLORS.BACKGROUND, padding: 16 },
  title: { color: VERIFICATION_COLORS.TEXT, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  reviewBlock: {
    marginTop: 20,
    backgroundColor: VERIFICATION_COLORS.CARD,
    borderRadius: 12,
    padding: 14,
  },
  reviewHint: { color: VERIFICATION_COLORS.TEXT, fontSize: 15, marginBottom: 8 },
  disputePath: { color: VERIFICATION_COLORS.ACCENT, fontSize: 15, fontWeight: '600' },
});

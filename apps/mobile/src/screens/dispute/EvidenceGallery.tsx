/**
 * EvidenceGallery — participant/resolver-gated evidence viewing (Spec 21).
 *
 * Lists the dispute's evidence references (their own + the auto-linked checklist/verification/arrival
 * refs). Tapping one resolves it via `GET .../evidence/:id/url` to a fresh pre-signed URL (visual) or
 * gated structured data (structured); nothing is public and no raw object key is ever held. Dark
 * BidClean tokens; all copy via i18n.
 */

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getEvidenceUrlRequest } from './dispute.api';
import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from './dispute.constants';
import type { DisputeEvidence } from './dispute.types';

export interface EvidenceGalleryProps {
  readonly disputeId: string;
  readonly evidence: readonly DisputeEvidence[];
}

export function EvidenceGallery({ disputeId, evidence }: EvidenceGalleryProps): React.JSX.Element {
  const { t } = useTranslation();

  const onOpen = useCallback(
    async (evidenceId: string) => {
      try {
        // Resolves to a fresh pre-signed URL (visual) or gated data (structured) — never public.
        await getEvidenceUrlRequest(disputeId, evidenceId);
      } catch {
        // Best-effort: a failed resolve simply does nothing (re-tappable).
      }
    },
    [disputeId],
  );

  return (
    <View style={styles.container} testID="dispute-evidence-gallery">
      <Text style={styles.title}>{t(DISPUTE_I18N_KEYS.EVIDENCE_TITLE)}</Text>
      {evidence.length === 0 ? (
        <Text style={styles.empty}>{t(DISPUTE_I18N_KEYS.EVIDENCE_EMPTY)}</Text>
      ) : (
        evidence.map((item) => (
          <TouchableOpacity
            key={item.id}
            testID={`dispute-evidence-${item.id}`}
            style={styles.row}
            onPress={() => void onOpen(item.id)}
          >
            <Text style={styles.rowText}>{item.kind}</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  title: { color: DISPUTE_COLORS.TEXT, fontSize: 16, fontWeight: '600' },
  empty: { color: DISPUTE_COLORS.TEXT_SECONDARY, fontSize: 14 },
  row: {
    backgroundColor: DISPUTE_COLORS.CARD,
    borderRadius: 10,
    padding: 12,
  },
  rowText: { color: DISPUTE_COLORS.TEXT, fontSize: 14 },
});

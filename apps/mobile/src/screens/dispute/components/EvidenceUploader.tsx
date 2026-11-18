/**
 * EvidenceUploader — grant-gated evidence photo upload (Spec 21).
 *
 * Picks an image via `expo-image-picker`, then runs the grant-gated flow: request an upload target
 * (grant persisted server-side first), PUT the bytes directly to MinIO, and finalize (the server
 * re-checks the grant + window + inspects the object). The client never chooses the object key and
 * never persists it. Dark BidClean tokens; all copy via i18n.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import {
  finalizeUploadRequest,
  putEvidenceBytes,
  requestUploadRequest,
} from '../dispute.api';
import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from '../dispute.constants';

export interface EvidenceUploaderProps {
  readonly disputeId: string;
  readonly disabled: boolean;
  readonly onUploaded: () => void;
}

export function EvidenceUploader({
  disputeId,
  disabled,
  onUploaded,
}: EvidenceUploaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return; // graceful: permission denied, no crash
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    const asset = picked.canceled ? undefined : picked.assets?.[0];
    if (asset === undefined) {
      return;
    }
    setBusy(true);
    try {
      const target = await requestUploadRequest(disputeId);
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      await putEvidenceBytes(target.uploadUrl, blob);
      await finalizeUploadRequest(disputeId, target.objectKey);
      onUploaded();
    } catch {
      // Errors surface via the store on the next reconcile; the uploader never crashes.
    } finally {
      setBusy(false);
    }
  }, [disputeId, onUploaded]);

  return (
    <TouchableOpacity
      testID="dispute-evidence-uploader"
      style={[styles.button, (disabled || busy) && styles.disabled]}
      disabled={disabled || busy}
      onPress={() => void onPress()}
    >
      <Text style={styles.text}>{t(DISPUTE_I18N_KEYS.ADD_PHOTO)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: DISPUTE_COLORS.ACCENT,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  text: { color: DISPUTE_COLORS.BACKGROUND, fontSize: 15, fontWeight: '700' },
});

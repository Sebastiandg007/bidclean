/**
 * ArrivalVerificationScreen (Cleaner) — record + upload the short arrival clip (Spec 18).
 *
 * Shown when the tracking session is ARRIVED and verification is enabled. Presents a clear
 * instruction ("Say: Hi, I'm [name]..."), a record/stop CTA, and an unobtrusive uploading/failed
 * state that NEVER blocks proceeding with the service. Camera/mic permission denial degrades
 * gracefully with an i18n explainer (never crashes, never hard-blocks). Records via
 * `useArrivalRecorder`, uploads via the store (request-upload → PUT → finalize). All copy comes from
 * i18n; dark BidClean tokens; accent record CTA.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CameraView } from 'expo-camera';

import { RecordButton } from './components/RecordButton';
import { useArrivalRecorder } from './useArrivalRecorder';
import { VERIFICATION_COLORS, VERIFICATION_I18N_KEYS } from './verification.constants';
import { useVerificationStore } from './verification.store';

export interface ArrivalVerificationScreenProps {
  route: { params: { verificationId: string } };
  navigation: { goBack: () => void };
}

export function ArrivalVerificationScreen(
  props: ArrivalVerificationScreenProps,
): React.JSX.Element {
  const { verificationId } = props.route.params;
  const { t } = useTranslation();
  const cameraRef = useRef<CameraView | null>(null);

  const recorder = useArrivalRecorder();
  const upload = useVerificationStore((store) => store.upload);
  const isUploading = useVerificationStore((store) => store.isUploading);
  const load = useVerificationStore((store) => store.load);

  useEffect(() => {
    void load(verificationId);
  }, [verificationId, load]);

  useEffect(() => {
    if (recorder.permissionStatus === 'unknown') {
      void recorder.requestPermission();
    }
  }, [recorder]);

  const onToggleRecord = useCallback(async () => {
    if (recorder.isRecording) {
      recorder.stopRecording(cameraRef.current);
      return;
    }
    const clip = await recorder.startRecording(cameraRef.current);
    if (clip !== null) {
      await upload(verificationId, clip);
    }
  }, [recorder, upload, verificationId]);

  const permissionDenied = recorder.permissionStatus === 'denied';

  return (
    <SafeAreaView style={styles.screen} testID="verification-cleaner-screen">
      <Text style={styles.title}>{t(VERIFICATION_I18N_KEYS.CLEANER_TITLE)}</Text>
      <Text style={styles.instruction}>{t(VERIFICATION_I18N_KEYS.CLEANER_INSTRUCTION)}</Text>

      {permissionDenied ? (
        <View style={styles.permissionBlock} testID="verification-permission-denied">
          <Text style={styles.permissionTitle}>
            {t(VERIFICATION_I18N_KEYS.PERMISSION_DENIED)}
          </Text>
          <Text style={styles.permissionExplainer}>
            {t(VERIFICATION_I18N_KEYS.PERMISSION_EXPLAINER)}
          </Text>
          <Text style={styles.skipHint}>{t(VERIFICATION_I18N_KEYS.SKIP_HINT)}</Text>
        </View>
      ) : (
        <View style={styles.cameraContainer} testID="verification-camera">
          <CameraView ref={cameraRef} style={styles.camera} mode="video" facing="front" />
        </View>
      )}

      {isUploading && (
        <Text style={styles.uploading} testID="verification-uploading">
          {t(VERIFICATION_I18N_KEYS.UPLOADING)}
        </Text>
      )}

      <RecordButton
        isRecording={recorder.isRecording}
        disabled={permissionDenied || isUploading}
        recordLabel={t(VERIFICATION_I18N_KEYS.RECORD)}
        stopLabel={t(VERIFICATION_I18N_KEYS.STOP)}
        onPress={onToggleRecord}
      />
      <Text style={styles.skipHint}>{t(VERIFICATION_I18N_KEYS.SKIP_HINT)}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: VERIFICATION_COLORS.BACKGROUND, padding: 16 },
  title: { color: VERIFICATION_COLORS.TEXT, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  instruction: { color: 'rgba(255,255,255,0.8)', fontSize: 15, marginBottom: 16 },
  cameraContainer: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: VERIFICATION_COLORS.CARD,
    marginBottom: 16,
  },
  camera: { flex: 1 },
  permissionBlock: {
    flex: 1,
    backgroundColor: VERIFICATION_COLORS.CARD,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  permissionTitle: {
    color: VERIFICATION_COLORS.TEXT,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  permissionExplainer: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 8 },
  uploading: { color: VERIFICATION_COLORS.ACCENT, fontSize: 14, marginBottom: 8 },
  skipHint: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 12 },
});

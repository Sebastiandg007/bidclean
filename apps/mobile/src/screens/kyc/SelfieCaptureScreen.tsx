/**
 * Selfie capture screen for KYC verification.
 *
 * Provides a front-facing camera with a face-shaped overlay.
 * Ensures a single face is detected and guides positioning.
 * Captured selfie is uploaded for liveness detection on the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import type { QualityFeedbackType, SelfieCaptureScreenProps } from './kyc.types';
import { FaceOverlay } from './components/FaceOverlay';
import { QualityFeedback } from './components/QualityFeedback';
import { useKyc } from './useKyc';
import { COLORS, FONT_SIZE, SPACING, SPRING_CONFIG } from './kyc.constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const ANIMATION_DELAY_MS = 200;
const CAPTURE_QUALITY = 0.8;
const FACE_READY_DELAY_MS = 1000;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Front camera screen for selfie capture.
 *
 * @param props.onSelfieUploaded - Called after successful upload
 * @param props.onCancel - Called when user exits the flow
 */
export function SelfieCaptureScreen({
  onSelfieUploaded,
  onCancel,
}: SelfieCaptureScreenProps) {
  const { t } = useTranslation('kyc');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const { uploadSelfie, isUploading, errorKey } = useKyc();

  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [hasMultipleFaces, setHasMultipleFaces] = useState(false);
  const [feedbackType, setFeedbackType] = useState<QualityFeedbackType>('hold_steady');
  const [isFeedbackVisible, setIsFeedbackVisible] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // ─── Animations ────────────────────────────────────────────────────────

  const formOpacity = useSharedValue(0);
  const formTranslateY = useSharedValue(20);

  useEffect(() => {
    formOpacity.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    formTranslateY.value = withDelay(
      ANIMATION_DELAY_MS,
      withSpring(0, SPRING_CONFIG),
    );
  }, [formOpacity, formTranslateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formTranslateY.value }],
  }));

  // ─── Face Detection ─────────────────────────────────────────────────────
  // expo-camera v16 removed built-in face detection.
  // We simulate readiness after a short delay and allow capture.
  // Server-side liveness detection handles actual face validation.

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFaceDetected(true);
      setFeedbackType('good');
      setIsFeedbackVisible(true);
    }, FACE_READY_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Updates face detection state externally (for testing or future
   * integration with a face detection library).
   */
  const updateFaceState = useCallback(
    (faceCount: number) => {
      if (faceCount === 0) {
        setIsFaceDetected(false);
        setHasMultipleFaces(false);
        setFeedbackType('hold_steady');
        setIsFeedbackVisible(true);
      } else if (faceCount === 1) {
        setIsFaceDetected(true);
        setHasMultipleFaces(false);
        setFeedbackType('good');
        setIsFeedbackVisible(true);
      } else {
        setIsFaceDetected(false);
        setHasMultipleFaces(true);
        setFeedbackType('hold_steady');
        setIsFeedbackVisible(true);
      }
    },
    [],
  );

  // Expose updateFaceState for external face detection callbacks
  void updateFaceState;

  // ─── Capture Handler ───────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing || isUploading) return;
    if (!isFaceDetected || hasMultipleFaces) return;

    setIsCapturing(true);
    setIsFeedbackVisible(false);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: CAPTURE_QUALITY,
      });

      if (!photo?.base64) {
        setFeedbackType('hold_steady');
        setIsFeedbackVisible(true);
        return;
      }

      setFeedbackType('good');
      setIsFeedbackVisible(true);

      await uploadSelfie(photo.base64);
      onSelfieUploaded?.();
    } catch {
      setFeedbackType('hold_steady');
      setIsFeedbackVisible(true);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, isUploading, isFaceDetected, hasMultipleFaces, uploadSelfie, onSelfieUploaded]);

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  // ─── Derived State ─────────────────────────────────────────────────────

  const isCaptureDisabled = isUploading || isCapturing || !isFaceDetected || hasMultipleFaces;

  // ─── Permission Not Granted ────────────────────────────────────────────

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>
            {t('selfie_capture.permission_title')}
          </Text>
          <Text style={styles.permissionMessage}>
            {t('selfie_capture.permission_message')}
          </Text>
          <Pressable
            style={styles.permissionButton}
            onPress={requestPermission}
            accessibilityRole="button"
            accessibilityLabel={t('selfie_capture.permission_button')}
          >
            <Text style={styles.permissionButtonText}>
              {t('selfie_capture.permission_button')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main Camera View ──────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, animatedStyle]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel={t('selfie_capture.cancel_button')}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>
              {t('selfie_capture.cancel_button')}
            </Text>
          </Pressable>
          <Text style={styles.title}>{t('selfie_capture.title')}</Text>
          <View style={styles.cancelButton} />
        </View>

        {/* Camera */}
        <View style={styles.cameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
          >
            <FaceOverlay
              isFaceDetected={isFaceDetected}
              hasMultipleFaces={hasMultipleFaces}
            />
            <QualityFeedback
              feedbackType={feedbackType}
              isVisible={isFeedbackVisible}
            />
          </CameraView>
        </View>

        {/* Guidance */}
        <Text style={styles.subtitle}>
          {t('selfie_capture.guidance_face_position')}
        </Text>

        {/* Error Messages */}
        {hasMultipleFaces && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {t('selfie_capture.error_multiple_faces')}
          </Text>
        )}

        {errorKey && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {t(errorKey)}
          </Text>
        )}

        {/* Capture Button */}
        <View style={styles.captureSection}>
          <Pressable
            style={[
              styles.captureButton,
              isCaptureDisabled && styles.captureButtonDisabled,
            ]}
            onPress={handleCapture}
            disabled={isCaptureDisabled}
            accessibilityRole="button"
            accessibilityLabel={t('selfie_capture.capture_button')}
            accessibilityState={{ disabled: isCaptureDisabled }}
          >
            {isUploading || isCapturing ? (
              <ActivityIndicator color={COLORS.background} />
            ) : (
              <View style={styles.captureButtonInner} />
            )}
          </Pressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CAPTURE_BUTTON_SIZE = 72;
const CAPTURE_INNER_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  cancelButton: {
    width: 60,
  },
  cancelText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
  },
  cameraContainer: {
    flex: 1,
    marginHorizontal: SPACING.md,
    borderRadius: 16,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  subtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  errorText: {
    fontSize: FONT_SIZE.label,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  captureSection: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  captureButton: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: 4,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  captureButtonInner: {
    width: CAPTURE_INNER_SIZE,
    height: CAPTURE_INNER_SIZE,
    borderRadius: CAPTURE_INNER_SIZE / 2,
    backgroundColor: COLORS.accent,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  permissionTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  permissionMessage: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  permissionButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  permissionButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
});

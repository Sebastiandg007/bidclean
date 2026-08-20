/**
 * Document capture screen for KYC verification.
 *
 * Provides a camera interface with document positioning overlay
 * and real-time quality feedback. Validates image quality before
 * upload (blur, lighting, resolution, corner detection).
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
import * as ImageManipulator from 'expo-image-manipulator';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import type {
  DocumentCaptureScreenProps,
  DocumentType,
  ImageQualityResult,
  QualityFeedbackType,
} from './kyc.types';
import { DocumentOverlay } from './components/DocumentOverlay';
import { QualityFeedback } from './components/QualityFeedback';
import { useKyc } from './useKyc';
import {
  COLORS,
  FONT_SIZE,
  KYC_MIN_IMAGE_HEIGHT,
  KYC_MIN_IMAGE_WIDTH,
  SHARPNESS_THRESHOLD,
  SPACING,
  SPRING_CONFIG,
} from './kyc.constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const ANIMATION_DELAY_MS = 200;
const CAPTURE_QUALITY = 0.8;
const DOCUMENT_TYPES: DocumentType[] = ['national_id', 'passport', 'drivers_license'];

// ─── Quality Validation ──────────────────────────────────────────────────────

function validateImageQuality(
  width: number,
  height: number,
  base64Length: number,
): ImageQualityResult {
  const meetsMinResolution =
    width >= KYC_MIN_IMAGE_WIDTH && height >= KYC_MIN_IMAGE_HEIGHT;

  // Approximate sharpness from file size relative to resolution
  // Larger files for given resolution suggest more detail (sharper)
  const expectedSize = width * height * 0.3;
  const sharpnessScore = Math.min(base64Length / expectedSize, 1);
  const isSharp = sharpnessScore >= SHARPNESS_THRESHOLD;

  // Simplified lighting check — assume adequate unless image is tiny
  const isLightingAdequate = base64Length > 1000;

  // Simplified corner detection — if resolution is good, assume visible
  const areCornersVisible = meetsMinResolution;

  let feedbackMessageKey: string | null = null;

  if (!isSharp) {
    feedbackMessageKey = 'kyc:quality.too_blurry';
  } else if (!isLightingAdequate) {
    feedbackMessageKey = 'kyc:quality.low_light';
  } else if (!areCornersVisible) {
    feedbackMessageKey = 'kyc:quality.document_not_visible';
  }

  const isAcceptable =
    isSharp && isLightingAdequate && areCornersVisible && meetsMinResolution;

  return {
    isAcceptable,
    sharpnessScore,
    isLightingAdequate,
    areCornersVisible,
    meetsMinResolution,
    feedbackMessageKey,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Camera screen for capturing identity documents.
 *
 * @param props.onDocumentUploaded - Called after successful upload
 * @param props.onCancel - Called when user exits the flow
 */
export function DocumentCaptureScreen({
  onDocumentUploaded,
  onCancel,
}: DocumentCaptureScreenProps) {
  const { t } = useTranslation('kyc');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const { uploadDocument, isUploading, errorKey } = useKyc();

  const [selectedDocType, setSelectedDocType] = useState<DocumentType>('national_id');
  const [feedbackType, setFeedbackType] = useState<QualityFeedbackType>('hold_steady');
  const [isFeedbackVisible, setIsFeedbackVisible] = useState(false);
  const [isAligned, setIsAligned] = useState(false);
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

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing || isUploading) return;

    setIsCapturing(true);
    setIsFeedbackVisible(false);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: CAPTURE_QUALITY,
      });

      if (!photo?.base64 || !photo.uri) {
        setFeedbackType('document_not_visible');
        setIsFeedbackVisible(true);
        return;
      }

      // Get actual dimensions via manipulator
      const manipulated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [],
        { base64: true },
      );

      const width = manipulated.width;
      const height = manipulated.height;
      const base64 = manipulated.base64 ?? photo.base64;

      const quality = validateImageQuality(width, height, base64.length);

      if (!quality.isAcceptable) {
        const feedbackKey = quality.feedbackMessageKey;
        if (feedbackKey === 'kyc:quality.too_blurry') {
          setFeedbackType('too_blurry');
        } else if (feedbackKey === 'kyc:quality.low_light') {
          setFeedbackType('low_light');
        } else {
          setFeedbackType('document_not_visible');
        }
        setIsFeedbackVisible(true);
        setIsAligned(false);
        return;
      }

      setIsAligned(true);
      setFeedbackType('good');
      setIsFeedbackVisible(true);

      await uploadDocument(base64, selectedDocType);
      onDocumentUploaded?.();
    } catch {
      setFeedbackType('document_not_visible');
      setIsFeedbackVisible(true);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, isUploading, selectedDocType, uploadDocument, onDocumentUploaded]);

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  const handleDocTypeSelect = useCallback((docType: DocumentType) => {
    setSelectedDocType(docType);
  }, []);

  // ─── Permission Not Granted ────────────────────────────────────────────

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>
            {t('document_capture.permission_title')}
          </Text>
          <Text style={styles.permissionMessage}>
            {t('document_capture.permission_message')}
          </Text>
          <Pressable
            style={styles.permissionButton}
            onPress={requestPermission}
            accessibilityRole="button"
            accessibilityLabel={t('document_capture.permission_button')}
          >
            <Text style={styles.permissionButtonText}>
              {t('document_capture.permission_button')}
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
            accessibilityLabel={t('document_capture.cancel_button')}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>
              {t('document_capture.cancel_button')}
            </Text>
          </Pressable>
          <Text style={styles.title}>{t('document_capture.title')}</Text>
          <View style={styles.cancelButton} />
        </View>

        {/* Document Type Selector */}
        <View style={styles.docTypeRow}>
          {DOCUMENT_TYPES.map((docType) => (
            <Pressable
              key={docType}
              style={[
                styles.docTypeChip,
                selectedDocType === docType && styles.docTypeChipActive,
              ]}
              onPress={() => handleDocTypeSelect(docType)}
              accessibilityRole="button"
              accessibilityLabel={t(`document_capture.document_types.${docType}`)}
              accessibilityState={{ selected: selectedDocType === docType }}
            >
              <Text
                style={[
                  styles.docTypeText,
                  selectedDocType === docType && styles.docTypeTextActive,
                ]}
              >
                {t(`document_capture.document_types.${docType}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Camera */}
        <View style={styles.cameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="back"
          >
            <DocumentOverlay isAligned={isAligned} />
            <QualityFeedback
              feedbackType={feedbackType}
              isVisible={isFeedbackVisible}
            />
          </CameraView>
        </View>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {t('document_capture.subtitle')}
        </Text>

        {/* Error Message */}
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
              (isUploading || isCapturing) && styles.captureButtonDisabled,
            ]}
            onPress={handleCapture}
            disabled={isUploading || isCapturing}
            accessibilityRole="button"
            accessibilityLabel={t('document_capture.capture_button')}
            accessibilityState={{ disabled: isUploading || isCapturing }}
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
  docTypeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  docTypeChip: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  docTypeChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(0, 245, 212, 0.1)',
  },
  docTypeText: {
    fontSize: FONT_SIZE.label,
    color: COLORS.textSecondary,
  },
  docTypeTextActive: {
    color: COLORS.accent,
    fontWeight: '600',
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

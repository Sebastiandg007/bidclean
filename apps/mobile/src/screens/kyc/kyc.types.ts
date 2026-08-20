/**
 * Shared types for the KYC verification screens.
 *
 * KYC flow: DocumentCapture → SelfieCapture → KycStatus
 */

/** KYC verification status values matching the backend state machine */
export type KycStatus =
  | 'NOT_STARTED'
  | 'DOCUMENT_UPLOADED'
  | 'SELFIE_UPLOADED'
  | 'PROCESSING'
  | 'VERIFIED'
  | 'REJECTED';

/** Supported identity document types for KYC verification */
export type DocumentType = 'national_id' | 'passport' | 'drivers_license';

/** Image quality validation result from client-side checks */
export interface ImageQualityResult {
  /** Whether the image passes all quality checks */
  isAcceptable: boolean;
  /** Blur detection score (higher = sharper) */
  sharpnessScore: number;
  /** Whether lighting conditions are adequate */
  isLightingAdequate: boolean;
  /** Whether all four document corners are visible */
  areCornersVisible: boolean;
  /** Whether the image meets minimum resolution requirements */
  meetsMinResolution: boolean;
  /** i18n key for user-facing feedback message (if quality fails) */
  feedbackMessageKey: string | null;
}

/** Response from GET /kyc/status */
export interface KycStatusResponse {
  /** Current verification status */
  status: KycStatus;
  /** Current attempt number */
  attemptNumber: number;
  /** Reason for rejection (present only when status is REJECTED) */
  rejectionReason: string | null;
  /** Timestamp when document was uploaded */
  documentUploadedAt: string | null;
  /** Timestamp when selfie was uploaded */
  selfieUploadedAt: string | null;
  /** Timestamp when processing started */
  processingStartedAt: string | null;
  /** Timestamp when verification completed */
  completedAt: string | null;
}

/** Request payload for document upload */
export interface DocumentUploadPayload {
  /** Base64-encoded document image */
  image: string;
  /** Type of identity document */
  documentType: DocumentType;
  /** Idempotency key to prevent duplicate uploads */
  idempotencyKey: string;
}

/** Request payload for selfie upload */
export interface SelfieUploadPayload {
  /** Base64-encoded selfie image */
  image: string;
  /** Idempotency key to prevent duplicate uploads */
  idempotencyKey: string;
}

/** Props for the DocumentCaptureScreen */
export interface DocumentCaptureScreenProps {
  /** Called when document is captured and uploaded successfully */
  onDocumentUploaded?: () => void;
  /** Called when user cancels the document capture */
  onCancel?: () => void;
}

/** Props for the SelfieCaptureScreen */
export interface SelfieCaptureScreenProps {
  /** Called when selfie is captured and uploaded successfully */
  onSelfieUploaded?: () => void;
  /** Called when user cancels the selfie capture */
  onCancel?: () => void;
}

/** Props for the KycStatusScreen */
export interface KycStatusScreenProps {
  /** Called when user initiates a retry */
  onRetry?: () => void;
  /** Called when verification is complete (status = VERIFIED) */
  onVerified?: () => void;
}

/** Quality feedback types for real-time camera guidance */
export type QualityFeedbackType =
  | 'too_blurry'
  | 'low_light'
  | 'document_not_visible'
  | 'hold_steady'
  | 'good';

/** Props for the QualityFeedback component */
export interface QualityFeedbackProps {
  /** Current quality feedback type */
  feedbackType: QualityFeedbackType;
  /** Whether the feedback is currently visible */
  isVisible: boolean;
}

/** Props for the DocumentOverlay component */
export interface DocumentOverlayProps {
  /** Whether the document is correctly aligned within the frame */
  isAligned: boolean;
}

/** Props for the FaceOverlay component */
export interface FaceOverlayProps {
  /** Whether a face is detected within the overlay */
  isFaceDetected: boolean;
  /** Whether multiple faces are detected (error state) */
  hasMultipleFaces: boolean;
}

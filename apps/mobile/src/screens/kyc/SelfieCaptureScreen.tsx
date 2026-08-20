/**
 * Selfie capture screen for KYC verification.
 *
 * Provides a front-facing camera with a face-shaped overlay.
 * Ensures a single face is detected and guides positioning.
 * Captured selfie is uploaded for liveness detection on the server.
 *
 * Implementation in Task 24.
 */

import type { SelfieCaptureScreenProps } from './kyc.types';

/**
 * Front camera screen for selfie capture.
 *
 * @param props.onSelfieUploaded - Called after successful upload
 * @param props.onCancel - Called when user exits the flow
 */
export function SelfieCaptureScreen({ onSelfieUploaded: _onSelfieUploaded, onCancel: _onCancel }: SelfieCaptureScreenProps) {
  // TODO(KYC-24): Implement front camera, face overlay, single-face validation, upload
  return null;
}

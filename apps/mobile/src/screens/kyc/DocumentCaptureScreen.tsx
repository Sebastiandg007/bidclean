/**
 * Document capture screen for KYC verification.
 *
 * Provides a camera interface with document positioning overlay
 * and real-time quality feedback. Validates image quality before
 * upload (blur, lighting, resolution, corner detection).
 *
 * Implementation in Task 23.
 */

import type { DocumentCaptureScreenProps } from './kyc.types';

/**
 * Camera screen for capturing identity documents.
 *
 * @param props.onDocumentUploaded - Called after successful upload
 * @param props.onCancel - Called when user exits the flow
 */
export function DocumentCaptureScreen({ onDocumentUploaded: _onDocumentUploaded, onCancel: _onCancel }: DocumentCaptureScreenProps) {
  // TODO(KYC-23): Implement camera view, overlay, quality checks, and upload
  return null;
}

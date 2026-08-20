/**
 * Face-shaped overlay guiding selfie positioning.
 *
 * Renders an oval/face-shaped guide on the front camera view.
 * Provides visual feedback when a face is detected and warns
 * if multiple faces are in frame.
 *
 * Implementation in Task 24 (SelfieCaptureScreen).
 */

import type { FaceOverlayProps } from '../kyc.types';

/**
 * Face positioning overlay for the selfie camera view.
 *
 * @param props.isFaceDetected - Whether a single face is detected
 * @param props.hasMultipleFaces - Whether multiple faces are detected (error)
 */
export function FaceOverlay({ isFaceDetected: _isFaceDetected, hasMultipleFaces: _hasMultipleFaces }: FaceOverlayProps) {
  // TODO(KYC-24): Implement face oval overlay with detection feedback
  return null;
}

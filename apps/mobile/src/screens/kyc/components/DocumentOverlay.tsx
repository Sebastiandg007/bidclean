/**
 * Camera overlay component showing correct document positioning frame.
 *
 * Renders a rectangular guide overlay on the camera view to help
 * users align their identity document. Border color changes to accent
 * when the document is correctly aligned.
 *
 * Implementation in Task 23 (DocumentCaptureScreen).
 */

import type { DocumentOverlayProps } from '../kyc.types';

/**
 * Document positioning overlay for the camera view.
 *
 * @param props.isAligned - Whether the document is correctly positioned
 */
export function DocumentOverlay({ isAligned: _isAligned }: DocumentOverlayProps) {
  // TODO(KYC-23): Implement overlay with animated border feedback
  return null;
}

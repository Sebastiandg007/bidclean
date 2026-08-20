/**
 * KYC status screen showing current verification state.
 *
 * Displays the KYC pipeline status (processing, verified, rejected)
 * with appropriate messaging and a retry button when rejected.
 * Polls the server for status updates while in PROCESSING state.
 *
 * Implementation in Task 25.
 */

import type { KycStatusScreenProps } from './kyc.types';

/**
 * Status display screen for KYC verification progress.
 *
 * @param props.onRetry - Called when user taps retry after rejection
 * @param props.onVerified - Called when verification completes successfully
 */
export function KycStatusScreen({ onRetry: _onRetry, onVerified: _onVerified }: KycStatusScreenProps) {
  // TODO(KYC-25): Implement status display, polling, retry button
  return null;
}

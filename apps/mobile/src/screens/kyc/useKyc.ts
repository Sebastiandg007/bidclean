/**
 * Custom hook for KYC verification business logic.
 *
 * Handles document/selfie upload, status polling, retry flow,
 * and quality validation orchestration.
 *
 * Implementation in Task 23-25.
 */

import type {
  DocumentType,
  KycStatus,
  KycStatusResponse,
} from './kyc.types';

/** Return type for the useKyc hook */
export interface UseKycReturn {
  /** Current KYC verification status */
  status: KycStatus;
  /** Whether the hook is currently loading data */
  isLoading: boolean;
  /** Whether an upload is in progress */
  isUploading: boolean;
  /** Error message key (i18n) if an operation failed */
  errorKey: string | null;
  /** Current attempt number */
  attemptNumber: number;
  /** Upload a captured document image */
  uploadDocument: (image: string, documentType: DocumentType) => Promise<void>;
  /** Upload a captured selfie image */
  uploadSelfie: (image: string) => Promise<void>;
  /** Start a new verification attempt (retry) */
  retry: () => Promise<void>;
  /** Refresh the current KYC status from the server */
  refreshStatus: () => Promise<void>;
  /** Full status response from the server */
  statusResponse: KycStatusResponse | null;
}

/**
 * Hook for managing the KYC verification flow.
 *
 * Provides upload functions, status polling, and retry logic.
 * All configurable values (timeouts, max file size) come from environment.
 *
 * @example
 * ```tsx
 * const { status, uploadDocument, isUploading, errorKey } = useKyc();
 * ```
 */
export function useKyc(): UseKycReturn {
  // TODO(KYC-23): Implement full hook logic with API calls and state management
  throw new Error('useKyc not yet implemented');
}

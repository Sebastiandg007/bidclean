/**
 * Custom hook for KYC verification business logic.
 *
 * Handles document/selfie upload, status polling, retry flow,
 * and quality validation orchestration.
 */

import { useCallback, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { apiClient } from '../../services/api.service';
import type {
  DocumentType,
  KycStatus,
  KycStatusResponse,
} from './kyc.types';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateIdempotencyKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook for managing the KYC verification flow.
 *
 * Provides upload functions, status polling, and retry logic.
 *
 * @example
 * ```tsx
 * const { status, uploadDocument, isUploading, errorKey } = useKyc();
 * ```
 */
export function useKyc(): UseKycReturn {
  const [status, setStatus] = useState<KycStatus>('NOT_STARTED');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [statusResponse, setStatusResponse] = useState<KycStatusResponse | null>(null);

  const refreshStatus = useCallback(async () => {
    setIsLoading(true);
    setErrorKey(null);

    try {
      const response = await apiClient.get<KycStatusResponse>('/kyc/status');
      const data = response.data;

      setStatus(data.status);
      setAttemptNumber(data.attemptNumber);
      setStatusResponse(data);
    } catch {
      setErrorKey('kyc:error.network_error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const uploadDocument = useCallback(
    async (image: string, documentType: DocumentType) => {
      setIsUploading(true);
      setErrorKey(null);

      try {
        const idempotencyKey = await generateIdempotencyKey();

        await apiClient.post(
          '/kyc/document',
          { image, documentType, idempotencyKey },
          { headers: { 'Idempotency-Key': idempotencyKey } },
        );

        setStatus('DOCUMENT_UPLOADED');
      } catch {
        setErrorKey('kyc:error.upload_failed');
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  const uploadSelfie = useCallback(async (image: string) => {
    setIsUploading(true);
    setErrorKey(null);

    try {
      const idempotencyKey = await generateIdempotencyKey();

      await apiClient.post(
        '/kyc/selfie',
        { image, idempotencyKey },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );

      setStatus('SELFIE_UPLOADED');
    } catch {
      setErrorKey('kyc:error.upload_failed');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const retry = useCallback(async () => {
    setIsLoading(true);
    setErrorKey(null);

    try {
      await apiClient.post('/kyc/retry');
      setStatus('NOT_STARTED');
      setAttemptNumber((prev) => prev + 1);
    } catch {
      setErrorKey('kyc:error.unknown_error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    status,
    isLoading,
    isUploading,
    errorKey,
    attemptNumber,
    uploadDocument,
    uploadSelfie,
    retry,
    refreshStatus,
    statusResponse,
  };
}

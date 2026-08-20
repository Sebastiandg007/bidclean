/**
 * Type definitions for the AI service client.
 * Describes request/response shapes for OCR, face comparison, and liveness endpoints.
 */

/** OCR extraction result from the AI service */
export interface OcrResult {
  readonly extractedName: string | null;
  readonly extractedDocumentNumber: string | null;
  readonly extractedExpiryDate: string | null;
  readonly extractedDocumentType: string | null;
  readonly faceDetected: boolean;
  readonly confidence: number;
}

/** Face comparison result from the AI service */
export interface FaceCompareResult {
  readonly similarityScore: number;
  readonly isMatch: boolean;
}

/** Liveness detection result from the AI service */
export interface LivenessResult {
  readonly livenessScore: number;
  readonly isLive: boolean;
}

/** OCR request payload */
export interface OcrRequest {
  readonly imageKey: string;
  readonly correlationId: string;
}

/** Face comparison request payload */
export interface FaceCompareRequest {
  readonly documentImageKey: string;
  readonly selfieImageKey: string;
  readonly correlationId: string;
}

/** Liveness detection request payload */
export interface LivenessRequest {
  readonly selfieImageKey: string;
  readonly correlationId: string;
}

/** AI service error response */
export interface AiServiceError {
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
}

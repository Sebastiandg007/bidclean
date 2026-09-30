/**
 * Typed contract + errors for the AI `/verify-face` client (Option A: bytes, no storage refs).
 *
 * Video bytes, reference bytes, and the returned score are treated as sensitive and are NEVER
 * embedded in an error message or log line — only structural/transport facts appear here.
 */

/** Base error for face-verify client failures. */
export class FaceVerifyClientError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = 'FaceVerifyClientError';
  }
}

/** The AI service returned an HTTP error. 5xx is retryable; 4xx is deterministic. */
export class FaceVerifyHttpError extends FaceVerifyClientError {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message, statusCode >= 500);
    this.name = 'FaceVerifyHttpError';
  }
}

/** Network-level failure reaching the AI service. */
export class FaceVerifyNetworkError extends FaceVerifyClientError {
  constructor(message: string) {
    super(message, true);
    this.name = 'FaceVerifyNetworkError';
  }
}

/** The face-verify request timed out. */
export class FaceVerifyTimeoutError extends FaceVerifyClientError {
  constructor() {
    super('Face verification request timed out', true);
    this.name = 'FaceVerifyTimeoutError';
  }
}

/** Response body shape the AI `/verify-face` endpoint returns. */
export interface VerifyFaceResponseBody {
  readonly score?: number;
  readonly decision?: string;
}

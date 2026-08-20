/**
 * Custom error classes for AI service communication failures.
 * Provides typed error handling for transient vs deterministic failures.
 */

/** Base error for all AI service communication issues */
export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly correlationId: string,
    public readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

/** AI service returned an HTTP error with a parseable error body */
export class AiServiceHttpError extends AiClientError {
  constructor(
    message: string,
    correlationId: string,
    public readonly statusCode: number,
    public readonly errorCode: string,
  ) {
    super(message, correlationId, statusCode >= 500);
    this.name = 'AiServiceHttpError';
  }
}

/** Network-level failure (connection refused, DNS error, etc.) */
export class AiServiceNetworkError extends AiClientError {
  constructor(message: string, correlationId: string) {
    super(message, correlationId, true);
    this.name = 'AiServiceNetworkError';
  }
}

/** Request timed out before receiving a response */
export class AiServiceTimeoutError extends AiClientError {
  constructor(correlationId: string) {
    super('AI service request timed out', correlationId, true);
    this.name = 'AiServiceTimeoutError';
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  OcrRequest,
  OcrResult,
  FaceCompareRequest,
  FaceCompareResult,
  LivenessRequest,
  LivenessResult,
  AiServiceError,
} from './ai-client.types';
import {
  AiClientError,
  AiServiceHttpError,
  AiServiceNetworkError,
  AiServiceTimeoutError,
} from './ai-client.errors';

/**
 * Client service for communicating with the FastAPI AI service.
 * Handles OCR, face comparison, and liveness detection requests.
 * Includes retry logic with exponential backoff for transient failures.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly httpClient: AxiosInstance;
  private readonly maxRetries: number;
  private readonly backoffMs: number;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.getOrThrow<string>('KYC_AI_SERVICE_URL');
    const authToken = this.configService.getOrThrow<string>('AI_SERVICE_AUTH_TOKEN');
    const timeoutMs = Number(this.configService.getOrThrow<string>('KYC_PROCESSING_TIMEOUT_MS'));

    this.maxRetries = Number(this.configService.getOrThrow<string>('KYC_PROCESSING_MAX_RETRIES'));
    this.backoffMs = Number(this.configService.getOrThrow<string>('KYC_PROCESSING_BACKOFF_MS'));

    this.httpClient = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    });
  }

  /**
   * Extract text and face from a document image.
   * @param request - OCR request with image key and correlation ID
   * @returns OCR extraction result
   */
  async extractDocument(request: OcrRequest): Promise<OcrResult> {
    return this.executeWithRetry<OcrResult>(
      '/ai/ocr',
      { imageKey: request.imageKey },
      request.correlationId,
    );
  }

  /**
   * Compare faces between document and selfie.
   * @param request - Face comparison request
   * @returns Face comparison result with similarity score
   */
  async compareFaces(request: FaceCompareRequest): Promise<FaceCompareResult> {
    return this.executeWithRetry<FaceCompareResult>(
      '/ai/face-compare',
      { documentImageKey: request.documentImageKey, selfieImageKey: request.selfieImageKey },
      request.correlationId,
    );
  }

  /**
   * Detect liveness/spoofing in a selfie image.
   * @param request - Liveness detection request
   * @returns Liveness result with score
   */
  async detectLiveness(request: LivenessRequest): Promise<LivenessResult> {
    return this.executeWithRetry<LivenessResult>(
      '/ai/liveness',
      { selfieImageKey: request.selfieImageKey },
      request.correlationId,
    );
  }

  /**
   * Execute a POST request with retry logic and exponential backoff.
   * Retries on transient failures (5xx, network errors, timeouts).
   * Does NOT retry on deterministic failures (4xx).
   */
  private async executeWithRetry<T>(
    path: string,
    body: Record<string, string>,
    correlationId: string,
  ): Promise<T> {
    let lastError: AiClientError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await this.sleep(this.calculateBackoff(attempt));
      }

      try {
        return await this.postRequest<T>(path, body, correlationId);
      } catch (error) {
        if (!(error instanceof AiClientError)) {
          throw error;
        }

        lastError = error;

        if (!error.isRetryable) {
          throw error;
        }

        this.logger.warn(
          `AI service request failed (attempt ${attempt + 1}/${this.maxRetries + 1}): ${error.message}`,
          { correlationId, path },
        );
      }
    }

    throw lastError;
  }

  /** Execute a single POST request to the AI service */
  private async postRequest<T>(
    path: string,
    body: Record<string, string>,
    correlationId: string,
  ): Promise<T> {
    try {
      const response = await this.httpClient.post<T>(path, body, {
        headers: { 'X-Request-ID': correlationId },
      });
      return response.data;
    } catch (error) {
      throw this.mapError(error as AxiosError, correlationId);
    }
  }

  /** Map axios errors to typed application errors */
  private mapError(error: AxiosError, correlationId: string): AiClientError {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new AiServiceTimeoutError(correlationId);
    }

    if (!error.response) {
      return new AiServiceNetworkError(
        error.message || 'Network error connecting to AI service',
        correlationId,
      );
    }

    const status = error.response.status;
    const responseData = error.response.data as Partial<AiServiceError> | undefined;
    const errorCode = responseData?.code ?? 'UNKNOWN_ERROR';
    const errorMessage = responseData?.message ?? `AI service returned HTTP ${status}`;

    return new AiServiceHttpError(errorMessage, correlationId, status, errorCode);
  }

  /** Calculate exponential backoff delay for a given attempt number */
  private calculateBackoff(attempt: number): number {
    return this.backoffMs * Math.pow(2, attempt - 1);
  }

  /** Sleep for the specified duration in milliseconds */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

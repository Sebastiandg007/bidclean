import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import FormData from 'form-data';

import {
  VIDEO_VERIFICATION_AI_URL,
  VIDEO_VERIFICATION_BACKOFF_DELAY_MS,
  VIDEO_VERIFICATION_MAX_RETRIES,
  VIDEO_VERIFICATION_TIMEOUT_MS,
} from '../video-verification.constants';
import { Decision, FaceVerifyResult } from '../video-verification.types';
import {
  FaceVerifyClientError,
  FaceVerifyHttpError,
  FaceVerifyNetworkError,
  FaceVerifyTimeoutError,
  VerifyFaceResponseBody,
} from './face-verify.types';

/** Multipart field names for the candidate (arrival video) and reference (KYC selfie) bytes. */
const CANDIDATE_FIELD = 'candidate';
const REFERENCE_FIELD = 'reference';
/** The AI service face-verify route. */
const VERIFY_FACE_PATH = '/verify-face';
/** Generic upload filenames (never derived from user content). */
const CANDIDATE_FILENAME = 'arrival-video';
const REFERENCE_FILENAME = 'reference-selfie';

/**
 * Face-verify client (mirrors `AiClientService` / `WhisperClient`).
 *
 * Sends the candidate (arrival video) + reference (KYC selfie) BYTES (multipart) to the AI/FastAPI
 * `/verify-face` endpoint — Option A: the AI service is given NO storage access. Returns
 * `{ score, decision }`. Bounded retries with exponential backoff on transient (5xx/network/timeout)
 * failures; deterministic (4xx) failures do not retry. Reuses the shared internal bearer token and
 * an `X-Request-ID` correlation header. Video/reference bytes and the returned score are never logged.
 */
@Injectable()
export class FaceVerifyClient {
  private readonly logger = new Logger(FaceVerifyClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly maxRetries = VIDEO_VERIFICATION_MAX_RETRIES;
  private readonly backoffMs = VIDEO_VERIFICATION_BACKOFF_DELAY_MS;

  constructor(private readonly configService: ConfigService) {
    const baseURL =
      this.configService.get<string>('VIDEO_VERIFICATION_AI_URL') ?? VIDEO_VERIFICATION_AI_URL;
    const authToken = this.configService.get<string>('AI_SERVICE_AUTH_TOKEN') ?? '';

    this.httpClient = axios.create({
      baseURL,
      timeout: VIDEO_VERIFICATION_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${authToken}` },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  }

  /**
   * Compare a candidate video against a reference selfie. Retries transient failures with
   * exponential backoff; throws a typed `FaceVerifyClientError` on terminal failure so the processor
   * can mark the verification FAILED.
   */
  async compare(
    candidateBytes: Buffer,
    referenceBytes: Buffer,
    requestId: string,
  ): Promise<FaceVerifyResult> {
    let lastError: FaceVerifyClientError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.calculateBackoff(attempt));
      }
      try {
        return await this.postCompare(candidateBytes, referenceBytes, requestId);
      } catch (error) {
        if (!(error instanceof FaceVerifyClientError)) {
          throw error;
        }
        lastError = error;
        if (!error.isRetryable) {
          throw error;
        }
        this.logger.warn(
          `Face verify attempt ${attempt + 1}/${this.maxRetries + 1} failed: ${error.message}`,
        );
      }
    }
    throw lastError ?? new FaceVerifyClientError('Face verification failed', false);
  }

  /** Post both byte streams as multipart form-data to the AI `/verify-face` endpoint. */
  private async postCompare(
    candidateBytes: Buffer,
    referenceBytes: Buffer,
    requestId: string,
  ): Promise<FaceVerifyResult> {
    const form = new FormData();
    form.append(CANDIDATE_FIELD, candidateBytes, { filename: CANDIDATE_FILENAME });
    form.append(REFERENCE_FIELD, referenceBytes, { filename: REFERENCE_FILENAME });
    try {
      const response = await this.httpClient.post<VerifyFaceResponseBody>(VERIFY_FACE_PATH, form, {
        headers: { ...form.getHeaders(), 'X-Request-ID': requestId },
      });
      return this.mapResult(response.data);
    } catch (error) {
      throw this.mapError(error as AxiosError);
    }
  }

  /** Map the AI response body to a typed result, defaulting a missing decision to INCONCLUSIVE. */
  private mapResult(body: VerifyFaceResponseBody): FaceVerifyResult {
    const score = typeof body.score === 'number' ? body.score : 0;
    const decision = this.parseDecision(body.decision);
    return { score, decision };
  }

  /** Parse the decision string into the typed union; anything unexpected → INCONCLUSIVE. */
  private parseDecision(value: string | undefined): Decision {
    if (value === Decision.MATCH || value === Decision.NO_MATCH) {
      return value;
    }
    return Decision.INCONCLUSIVE;
  }

  /** Map an axios error to a typed FaceVerifyClientError (retryable classification). */
  private mapError(error: AxiosError): FaceVerifyClientError {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new FaceVerifyTimeoutError();
    }
    if (!error.response) {
      return new FaceVerifyNetworkError(error.message || 'Network error reaching AI service');
    }
    return new FaceVerifyHttpError(
      `AI service returned HTTP ${error.response.status}`,
      error.response.status,
    );
  }

  /** Exponential backoff for a given attempt number. */
  private calculateBackoff(attempt: number): number {
    return this.backoffMs * Math.pow(2, attempt - 1);
  }

  /** Sleep for the given milliseconds. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import FormData from 'form-data';

import {
  VOICE_AI_SERVICE_URL,
  VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS,
  VOICE_TRANSCRIPTION_MAX_RETRIES,
  VOICE_TRANSCRIPTION_TIMEOUT_MS,
} from './voice.constants';
import { TranscriptionResult } from './voice.types';

/** The AI service multipart field name for the audio bytes. */
const AUDIO_FIELD = 'audio';
/** The AI service transcription route. */
const TRANSCRIBE_PATH = '/transcribe';
/** A generic upload filename (never derived from user content). */
const UPLOAD_FILENAME = 'voice-note';

/** Base error for Whisper transcription client failures. */
export class WhisperClientError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = 'WhisperClientError';
  }
}

/** The AI service returned an HTTP error. 5xx is retryable; 4xx is deterministic. */
export class WhisperHttpError extends WhisperClientError {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message, statusCode >= 500);
    this.name = 'WhisperHttpError';
  }
}

/** Network-level failure reaching the AI service. */
export class WhisperNetworkError extends WhisperClientError {
  constructor(message: string) {
    super(message, true);
    this.name = 'WhisperNetworkError';
  }
}

/** The transcription request timed out. */
export class WhisperTimeoutError extends WhisperClientError {
  constructor() {
    super('Transcription request timed out', true);
    this.name = 'WhisperTimeoutError';
  }
}

/** Response body shape the AI /transcribe endpoint returns. */
interface TranscribeResponseBody {
  readonly text?: string;
  readonly language?: string | null;
}

/**
 * Whisper transcription client (mirrors `AiClientService`).
 *
 * Sends the audio BYTES (multipart) to the AI/FastAPI `/transcribe` endpoint (Option A: the AI
 * service is given NO storage access) and returns `{ text, language }`. Bounded retries with
 * exponential backoff on transient (5xx/network/timeout) failures; deterministic (4xx) failures do
 * not retry. Audio bytes and the returned transcript are never logged.
 */
@Injectable()
export class WhisperClient {
  private readonly logger = new Logger(WhisperClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly maxRetries = VOICE_TRANSCRIPTION_MAX_RETRIES;
  private readonly backoffMs = VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS;

  constructor(private readonly configService: ConfigService) {
    const baseURL =
      this.configService.get<string>('VOICE_AI_SERVICE_URL') ?? VOICE_AI_SERVICE_URL;
    const authToken = this.configService.get<string>('AI_SERVICE_AUTH_TOKEN') ?? '';

    this.httpClient = axios.create({
      baseURL,
      timeout: VOICE_TRANSCRIPTION_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${authToken}` },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  }

  /**
   * Transcribe an audio buffer. Retries transient failures with exponential backoff; throws a
   * typed `WhisperClientError` on terminal failure so the processor can mark the note FAILED.
   */
  async transcribe(audioBytes: Buffer): Promise<TranscriptionResult> {
    let lastError: WhisperClientError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.calculateBackoff(attempt));
      }
      try {
        return await this.postAudio(audioBytes);
      } catch (error) {
        if (!(error instanceof WhisperClientError)) {
          throw error;
        }
        lastError = error;
        if (!error.isRetryable) {
          throw error;
        }
        this.logger.warn(
          `Transcription attempt ${attempt + 1}/${this.maxRetries + 1} failed: ${error.message}`,
        );
      }
    }

    throw lastError ?? new WhisperClientError('Transcription failed', false);
  }

  /** Post the audio bytes as multipart form-data to the AI /transcribe endpoint. */
  private async postAudio(audioBytes: Buffer): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append(AUDIO_FIELD, audioBytes, { filename: UPLOAD_FILENAME });
    try {
      const response = await this.httpClient.post<TranscribeResponseBody>(
        TRANSCRIBE_PATH,
        form,
        { headers: form.getHeaders() },
      );
      const text = response.data.text ?? '';
      return { text, language: response.data.language ?? null };
    } catch (error) {
      throw this.mapError(error as AxiosError);
    }
  }

  /** Map an axios error to a typed WhisperClientError (retryable classification). */
  private mapError(error: AxiosError): WhisperClientError {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new WhisperTimeoutError();
    }
    if (!error.response) {
      return new WhisperNetworkError(error.message || 'Network error reaching AI service');
    }
    return new WhisperHttpError(
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
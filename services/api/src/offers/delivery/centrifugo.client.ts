import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

import { OFFER_MAX_RETRIES, OFFER_BACKOFF_DELAY_MS } from '../offers.constants';
import {
  CentrifugoPublishRequest,
  CentrifugoBroadcastRequest,
  CentrifugoClientConfig,
} from './delivery.types';

/** Default HTTP timeout for Centrifugo requests (ms) */
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

/**
 * Centrifugo HTTP API client.
 *
 * Publishes real-time offer events to Cleaner personal channels.
 * Uses the Centrifugo server API (not the client SDK).
 *
 * Configuration via environment variables:
 * - CENTRIFUGO_API_URL: Base URL of the Centrifugo server API
 * - CENTRIFUGO_API_KEY: Authorization key for the API
 *
 * Error handling: retries with exponential backoff on transient failures.
 * Centrifugo is a transport layer only — PostgreSQL is the source of truth.
 */
@Injectable()
export class CentrifugoClient {
  private readonly logger = new Logger(CentrifugoClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly config: CentrifugoClientConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
    this.httpClient = this.createHttpClient();
  }

  /**
   * Publish a message to a single Centrifugo channel.
   *
   * @param channel - Target channel name (e.g. `offers:cleaner:{cleanerId}`)
   * @param data - Payload to deliver (serialized to JSON by Centrifugo)
   * @returns true if published successfully, false on permanent failure
   */
  async publish(channel: string, data: unknown): Promise<boolean> {
    if (!channel) {
      this.logger.warn('publish called with empty channel, skipping');
      return false;
    }

    const body: CentrifugoPublishRequest = { channel, data };
    return this.executeWithRetry('/api/publish', body, { channel });
  }

  /**
   * Broadcast a message to multiple Centrifugo channels simultaneously.
   *
   * @param channels - Array of target channel names
   * @param data - Payload to deliver to all channels
   * @returns true if broadcast succeeded, false on permanent failure
   */
  async broadcast(channels: string[], data: unknown): Promise<boolean> {
    if (!channels.length) {
      this.logger.warn('broadcast called with empty channels array, skipping');
      return false;
    }

    const body: CentrifugoBroadcastRequest = { channels, data };
    return this.executeWithRetry('/api/broadcast', body, {
      channelCount: channels.length,
    });
  }

  /**
   * Execute an HTTP POST with exponential backoff retry on transient failures.
   */
  private async executeWithRetry(
    endpoint: string,
    body: CentrifugoPublishRequest | CentrifugoBroadcastRequest,
    logContext: Record<string, unknown>,
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.httpClient.post(endpoint, body);
        return true;
      } catch (error) {
        const shouldRetry =
          this.isTransientError(error) && attempt < this.config.maxRetries;

        if (!shouldRetry) {
          this.logPermanentFailure(endpoint, error, logContext, attempt);
          return false;
        }

        const delayMs = this.calculateBackoffDelay(attempt);
        this.logger.warn(
          `Transient failure on ${endpoint}, retrying in ${delayMs}ms ` +
            `(attempt ${attempt + 1}/${this.config.maxRetries})`,
          logContext,
        );
        await this.sleep(delayMs);
      }
    }

    return false;
  }

  /**
   * Determine if an error is transient and eligible for retry.
   * Network errors and 5xx server errors are considered transient.
   */
  private isTransientError(error: unknown): boolean {
    if (!this.isAxiosError(error)) {
      return false;
    }

    if (!error.response) {
      return true; // Network error (no response received)
    }

    return error.response.status >= 500;
  }

  /** Calculate exponential backoff delay for a given attempt */
  private calculateBackoffDelay(attempt: number): number {
    return this.config.backoffDelayMs * Math.pow(2, attempt);
  }

  /** Log a permanent (non-retryable) failure */
  private logPermanentFailure(
    endpoint: string,
    error: unknown,
    context: Record<string, unknown>,
    attempt: number,
  ): void {
    const message = this.isAxiosError(error)
      ? error.response?.data ?? error.message
      : String(error);

    this.logger.error(
      `Centrifugo ${endpoint} failed after ${attempt + 1} attempt(s): ` +
        `${JSON.stringify(message)}`,
      undefined,
      JSON.stringify(context),
    );
  }

  /** Type guard for AxiosError */
  private isAxiosError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error);
  }

  /** Promise-based sleep utility */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Load and validate configuration from environment */
  private loadConfig(): CentrifugoClientConfig {
    const apiUrl = this.configService.get<string>('CENTRIFUGO_API_URL', '');
    const apiKey = this.configService.get<string>('CENTRIFUGO_API_KEY', '');

    if (!apiUrl) {
      this.logger.warn('CENTRIFUGO_API_URL is not configured');
    }
    if (!apiKey) {
      this.logger.warn('CENTRIFUGO_API_KEY is not configured');
    }

    return {
      apiUrl,
      apiKey,
      maxRetries: OFFER_MAX_RETRIES,
      backoffDelayMs: OFFER_BACKOFF_DELAY_MS,
    };
  }

  /** Create configured axios instance with base URL and auth headers */
  private createHttpClient(): AxiosInstance {
    const timeoutMs = this.configService.get<number>(
      'CENTRIFUGO_TIMEOUT_MS',
      DEFAULT_HTTP_TIMEOUT_MS,
    );

    return axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `apikey ${this.config.apiKey}`,
      },
      timeout: timeoutMs,
    });
  }
}

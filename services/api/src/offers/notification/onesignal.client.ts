import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/** Default OneSignal REST API base URL (overridable via env for testing) */
const DEFAULT_ONESIGNAL_API_URL = 'https://onesignal.com/api/v1';

/** Default HTTP timeout for OneSignal requests in milliseconds */
const DEFAULT_ONESIGNAL_TIMEOUT_MS = 10_000;

/** Payload shape for OneSignal push notifications */
export interface OneSignalNotificationPayload {
  /** Notification heading (title) mapped by locale */
  readonly headings: Record<string, string>;
  /** Notification body content mapped by locale */
  readonly contents: Record<string, string>;
  /** Custom data payload for deep linking */
  readonly data: Record<string, string>;
}

/**
 * OneSignal push notification client.
 *
 * Sends push notifications via the OneSignal REST API.
 * Used as a fallback delivery channel when WebSocket delivery fails.
 *
 * Configuration via environment variables:
 * - ONESIGNAL_APP_ID: OneSignal application identifier
 * - ONESIGNAL_API_KEY: REST API key for server-side sends
 * - ONESIGNAL_API_URL: (optional) API base URL override for testing
 * - ONESIGNAL_TIMEOUT_MS: (optional) HTTP timeout in ms
 *
 * Handles transient failures gracefully — push delivery is best-effort.
 * No retry logic here; BullMQ handles retries at the queue level.
 */
@Injectable()
export class OneSignalClient {
  private readonly logger = new Logger(OneSignalClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly appId: string;

  constructor(private readonly configService: ConfigService) {
    this.appId = this.configService.get<string>('ONESIGNAL_APP_ID', '');
    const apiKey = this.configService.get<string>('ONESIGNAL_API_KEY', '');
    const apiUrl = this.configService.get<string>(
      'ONESIGNAL_API_URL',
      DEFAULT_ONESIGNAL_API_URL,
    );
    const timeoutMs = this.configService.get<number>(
      'ONESIGNAL_TIMEOUT_MS',
      DEFAULT_ONESIGNAL_TIMEOUT_MS,
    );

    this.httpClient = axios.create({
      baseURL: apiUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
    });
  }

  /**
   * Send a push notification to a specific external user ID.
   *
   * Uses OneSignal's `include_external_user_ids` to target the Cleaner
   * by their internal user ID (cleanerId).
   *
   * @param externalUserId - The Cleaner's user ID (used as OneSignal external user ID)
   * @param payload - Notification content (headings, contents, data)
   * @returns true if OneSignal accepted the notification, false on failure
   */
  async sendToUser(
    externalUserId: string,
    payload: OneSignalNotificationPayload,
  ): Promise<boolean> {
    if (!externalUserId) {
      this.logger.warn('sendToUser called with empty externalUserId — skipping');
      return false;
    }

    if (!this.appId) {
      this.logger.warn('ONESIGNAL_APP_ID not configured — push disabled');
      return false;
    }

    return this.sendNotification(externalUserId, payload);
  }

  /** Build and send the notification request to OneSignal. */
  private async sendNotification(
    externalUserId: string,
    payload: OneSignalNotificationPayload,
  ): Promise<boolean> {
    const body = {
      app_id: this.appId,
      include_external_user_ids: [externalUserId],
      headings: payload.headings,
      contents: payload.contents,
      data: payload.data,
    };

    try {
      const response = await this.httpClient.post('/notifications', body);
      const recipientCount = response.data?.recipients ?? 0;

      if (recipientCount === 0) {
        this.logger.debug(
          `Push accepted but 0 recipients for user=${externalUserId}`,
        );
      }

      return true;
    } catch (error) {
      this.logSendError(externalUserId, error);
      return false;
    }
  }

  /** Log push notification failure with context. */
  private logSendError(externalUserId: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'no response';
      const message = error.response?.data?.errors?.[0] ?? error.message;
      this.logger.warn(
        `Push notification failed for user=${externalUserId}: HTTP ${status} — ${message}`,
      );
      return;
    }

    this.logger.warn(
      `Push notification failed for user=${externalUserId}: ${String(error)}`,
    );
  }
}

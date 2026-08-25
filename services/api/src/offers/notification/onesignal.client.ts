import { Injectable, Logger } from '@nestjs/common';

/**
 * OneSignal push notification client.
 *
 * Sends push notifications via the OneSignal REST API.
 *
 * Configuration via environment variables:
 * - ONESIGNAL_APP_ID: OneSignal application identifier
 * - ONESIGNAL_API_KEY: REST API key for server-side sends
 *
 * Handles transient failures gracefully — push delivery is best-effort.
 */
@Injectable()
export class OneSignalClient {
  private readonly logger = new Logger(OneSignalClient.name);

  /**
   * Send a push notification to a specific external user ID.
   */
  async sendToUser(
    _externalUserId: string,
    _payload: unknown,
  ): Promise<boolean> {
    // TODO: Implement in Task 21
    void this.logger;
    return false;
  }
}

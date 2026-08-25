import { Injectable, Logger } from '@nestjs/common';

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

  /**
   * Publish a message to a single Centrifugo channel.
   */
  async publish(_channel: string, _data: unknown): Promise<boolean> {
    // TODO: Implement in Task 19
    void this.logger;
    return false;
  }

  /**
   * Broadcast a message to multiple channels.
   */
  async broadcast(_channels: string[], _data: unknown): Promise<boolean> {
    // TODO: Implement in Task 19
    return false;
  }
}

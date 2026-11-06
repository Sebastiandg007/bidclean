import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  ONESIGNAL_API_KEY,
  ONESIGNAL_API_URL,
  ONESIGNAL_APP_ID,
  ONESIGNAL_TIMEOUT_MS,
} from '../notifications.constants';

/** Payload for a per-device OneSignal push (Model B: targets specific player ids). */
export interface OneSignalSendInput {
  /** The consented player ids to target (never a blanket external-user-id fan-out). */
  readonly playerIds: readonly string[];
  /** Locale-keyed heading map (e.g. { en, es }). */
  readonly headings: Record<string, string>;
  /** Locale-keyed body map. */
  readonly contents: Record<string, string>;
  /** Deep-link data payload (ids only, no sensitive content). */
  readonly data: Record<string, string>;
  /** Optional provider idempotency key (used where OneSignal supports one). */
  readonly idempotencyKey?: string;
}

/** Result of a send attempt, including any player ids OneSignal reported invalid. */
export interface OneSignalSendResult {
  readonly ok: boolean;
  /** Player ids OneSignal reported as invalid/unsubscribed (to be marked stale). */
  readonly invalidPlayerIds: readonly string[];
}

/**
 * Generalized OneSignal transport client (moved/generalized from the offer-scoped client).
 *
 * Best-effort: it wraps the OneSignal REST API, never throws into callers, and logs failures
 * WITHOUT secrets or PII. Sends target specific `player_ids` (Model B). It also associates the
 * internal user id as the OneSignal external user id and sets segmentation tags. The REST API key
 * is read from server config only and never leaves the server.
 */
@Injectable()
export class OneSignalClient {
  private readonly logger = new Logger(OneSignalClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly appId: string;

  constructor() {
    this.appId = ONESIGNAL_APP_ID;
    this.httpClient = axios.create({
      baseURL: ONESIGNAL_API_URL,
      timeout: ONESIGNAL_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${ONESIGNAL_API_KEY}`,
      },
    });
  }

  /**
   * Send a push to specific consented player ids (Model B). Returns `ok` plus any invalid player
   * ids OneSignal reported. Never throws; a transport failure returns `{ ok: false }` so BullMQ
   * decides retry vs. dead-letter.
   */
  async send(input: OneSignalSendInput): Promise<OneSignalSendResult> {
    if (input.playerIds.length === 0) {
      return { ok: true, invalidPlayerIds: [] };
    }
    if (!this.appId) {
      this.logger.warn('ONESIGNAL_APP_ID not configured — push disabled');
      return { ok: false, invalidPlayerIds: [] };
    }

    const body: Record<string, unknown> = {
      app_id: this.appId,
      include_player_ids: [...input.playerIds],
      headings: input.headings,
      contents: input.contents,
      data: input.data,
    };
    const headers = input.idempotencyKey
      ? { 'Idempotency-Key': input.idempotencyKey }
      : undefined;

    try {
      const response = await this.httpClient.post('/notifications', body, { headers });
      const invalid = this.extractInvalidPlayerIds(response.data);
      return { ok: true, invalidPlayerIds: invalid };
    } catch (error) {
      this.logSendError(error);
      return { ok: false, invalidPlayerIds: [] };
    }
  }

  /**
   * Associate the internal user id as the OneSignal external user id and set segmentation tags for
   * a device (player id). Best-effort — logs and swallows failures (registry is the source of truth).
   */
  async syncDevice(
    playerId: string,
    externalUserId: string,
    tags: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    if (!this.appId || !playerId) {
      return false;
    }
    try {
      await this.httpClient.put(`/players/${playerId}`, {
        app_id: this.appId,
        external_user_id: externalUserId,
        tags,
      });
      return true;
    } catch (error) {
      this.logSyncError(error);
      return false;
    }
  }

  /** OneSignal returns `errors.invalid_player_ids` (or `invalid_external_user_ids`) when present. */
  private extractInvalidPlayerIds(data: unknown): string[] {
    if (typeof data !== 'object' || data === null) {
      return [];
    }
    const errors = (data as { errors?: unknown }).errors;
    if (typeof errors === 'object' && errors !== null) {
      const invalid = (errors as { invalid_player_ids?: unknown }).invalid_player_ids;
      if (Array.isArray(invalid)) {
        return invalid.filter((id): id is string => typeof id === 'string');
      }
    }
    return [];
  }

  private logSendError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'no response';
      this.logger.warn(`OneSignal send failed: HTTP ${status}`);
      return;
    }
    this.logger.warn(`OneSignal send failed: ${this.safeError(error)}`);
  }

  private logSyncError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 'no response';
      this.logger.warn(`OneSignal device sync failed: HTTP ${status}`);
      return;
    }
    this.logger.warn(`OneSignal device sync failed: ${this.safeError(error)}`);
  }

  /** Never echo response bodies (may carry tokens/PII); only the error class/message. */
  private safeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}

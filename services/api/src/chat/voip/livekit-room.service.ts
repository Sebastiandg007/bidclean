import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RoomServiceClient } from 'livekit-server-sdk';

import {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_URL,
} from './voip.constants';

/**
 * LiveKitRoomService — opaque room-name generation + best-effort room admin.
 *
 * Mirrors the `VoiceNoteStorageService` / `CentrifugoClient` seam: a thin config-driven wrapper
 * over the LiveKit server SDK's room admin API. It does NOT sign access tokens (that is
 * `LiveKitTokenService`). Two responsibilities:
 *   - `generateRoomName()` — an opaque, unguessable room id (`crypto.randomUUID`), never reused
 *     across calls (the DB enforces uniqueness). A room name is a reference, never a credential.
 *   - `deleteRoomSafe(roomName)` — idempotent, best-effort teardown on a terminal transition. Call
 *     correctness NEVER depends on it: LiveKit auto-closes an empty room after its `empty_timeout`,
 *     so a failure here is logged and swallowed.
 */
@Injectable()
export class LiveKitRoomService {
  private readonly logger = new Logger(LiveKitRoomService.name);
  private client: RoomServiceClient | null = null;

  /**
   * Generate an opaque, unguessable room name. The `call-` prefix namespaces LiveKit rooms without
   * leaking any conversation/participant identity; the UUID body is the unguessable part.
   */
  generateRoomName(): string {
    return `call-${randomUUID()}`;
  }

  /**
   * Best-effort, idempotent room teardown. Swallows every error (an already-gone room, a transient
   * LiveKit outage) so a terminal call transition never fails on media teardown.
   */
  async deleteRoomSafe(roomName: string): Promise<void> {
    try {
      await this.roomClient().deleteRoom(roomName);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Best-effort LiveKit room delete failed for ${roomName}: ${reason}`);
    }
  }

  /**
   * Lazily construct the room admin client from configuration. The LiveKit server SDK's room admin
   * API is HTTP; derive the HTTP(S) base from the (ws/wss) `LIVEKIT_URL` so a single configured URL
   * drives both the media connection (client) and admin (server).
   */
  private roomClient(): RoomServiceClient {
    if (!this.client) {
      this.client = new RoomServiceClient(
        this.httpUrl(LIVEKIT_URL),
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
      );
    }
    return this.client;
  }

  /** Map a `ws://`/`wss://` LiveKit URL to its `http://`/`https://` admin equivalent. */
  private httpUrl(url: string): string {
    if (url.startsWith('wss://')) {
      return `https://${url.slice('wss://'.length)}`;
    }
    if (url.startsWith('ws://')) {
      return `http://${url.slice('ws://'.length)}`;
    }
    return url;
  }
}

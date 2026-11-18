import { Injectable } from '@nestjs/common';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

import {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_URL,
  VOIP_MEDIA_TOKEN_TTL_SECONDS,
  VOIP_VIDEO_ENABLED,
} from './voip.constants';
import { MediaToken } from './voip.types';

/** Milliseconds per second (TTL/expiry math). */
const MS_PER_SECOND = 1000;

/** Parameters for minting a LiveKit access token — always resolved server-side. */
export interface MintLiveKitTokenParams {
  /** The authenticated participant's BidClean user id (the token identity). */
  readonly identity: string;
  /** The call's room name, resolved FROM THE DB — never client-supplied. */
  readonly roomName: string;
  /** Whether this call may carry video (media_kind = VIDEO AND VOIP_VIDEO_ENABLED). */
  readonly canPublishVideo: boolean;
}

/**
 * LiveKitTokenService — mints short-lived, room-scoped LiveKit access tokens.
 *
 * The media-token counterpart to `CentrifugoTokenService`: it signs a bounded-TTL JWT via the
 * LiveKit server SDK using `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (which live ONLY on the server —
 * only the time-boxed token ever reaches the client). The token authorizes exactly ONE identity to
 * join exactly ONE room with publish/subscribe of audio (and video only when allowed); it NEVER
 * grants room-create, room-list, or admin capabilities. This service is deliberately dumb: it
 * enforces no business rules — the caller (`VoipService`) applies the participation + status+role
 * gate BEFORE asking for a token, and always supplies a server-resolved `roomName`.
 */
@Injectable()
export class LiveKitTokenService {
  /**
   * Mint a short-lived access token for one identity + one room. `canPublishVideo` is honored only
   * when video is enabled by configuration; audio publish/subscribe is always granted.
   */
  async mintToken(params: MintLiveKitTokenParams): Promise<MediaToken> {
    const ttlSeconds = VOIP_MEDIA_TOKEN_TTL_SECONDS;
    const allowVideo = params.canPublishVideo && VOIP_VIDEO_ENABLED;

    // Restrict publishable sources explicitly: microphone always, camera only when video is
    // allowed. This is the token-level enforcement of "video only when media_kind = VIDEO".
    const publishSources = allowVideo
      ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
      : [TrackSource.MICROPHONE];

    const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: params.identity,
      ttl: `${ttlSeconds}s`,
    });
    accessToken.addGrant({
      room: params.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: publishSources,
      // Never grant admin/list/create — a media token is join-only, scoped to this one room.
      roomCreate: false,
      roomList: false,
      roomAdmin: false,
    });

    const token = await accessToken.toJwt();
    return {
      livekitUrl: LIVEKIT_URL,
      token,
      expiresAt: new Date(Date.now() + ttlSeconds * MS_PER_SECOND).toISOString(),
    };
  }
}

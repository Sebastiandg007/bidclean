import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

import {
  CENTRIFUGO_TOKEN_SECRET,
  CHAT_CONNECTION_TOKEN_TTL_SECONDS,
} from '../../chat/chat.constants';

/**
 * CentrifugoTokenService — mints HMAC-signed Centrifugo tokens (auth-owned).
 *
 * Two token kinds, both HS256-signed with the shared `CENTRIFUGO_TOKEN_SECRET` and a bounded
 * expiry:
 * - **connection token**: `{ sub }` — authenticates the WebSocket connection; `sub` is the
 *   authenticated user's id (Centrifugo binds the connection to it).
 * - **subscription token**: `{ sub, channel }` — authorizes a subscription to a specific private
 *   channel; issued by the controller ONLY after the chat participation check passes.
 *
 * The subject is always the authenticated user id passed by the controller — this service never
 * reads a client-supplied subject or trusts a channel string as proof of anything. Tampered or
 * expired tokens are rejected by Centrifugo (bounded `exp`).
 */
@Injectable()
export class CentrifugoTokenService {
  /** Mint a connection token binding the socket to the authenticated user. */
  mintConnectionToken(userId: string): string {
    return this.sign({ sub: userId });
  }

  /** Mint a subscription token scoping the authenticated user to a single channel. */
  mintSubscriptionToken(userId: string, channel: string): string {
    return this.sign({ sub: userId, channel });
  }

  /** Sign an HS256 token with a bounded expiry from configuration. */
  private sign(claims: Readonly<Record<string, string>>): string {
    return jwt.sign(claims, CENTRIFUGO_TOKEN_SECRET, {
      algorithm: 'HS256',
      expiresIn: CHAT_CONNECTION_TOKEN_TTL_SECONDS,
    });
  }
}

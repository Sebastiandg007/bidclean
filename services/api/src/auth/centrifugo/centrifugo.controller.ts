import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';

import { ChatParticipationService } from '../../chat/chat-participation.service';
import { CHAT_CHANNEL_PREFIX } from '../../chat/chat.constants';
import { User } from '../entities/user.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtUserPayload } from '../guards/jwt.types';
import { CentrifugoTokenService } from './centrifugo-token.service';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/** Response carrying a signed Centrifugo token. */
interface CentrifugoTokenResponse {
  readonly token: string;
}

/**
 * Centrifugo token endpoint (auth-owned).
 *
 * `GET /auth/centrifugo/token` mints a connection token for the authenticated Keycloak subject.
 * With `?channel=chat:conversation:{id}` it mints a subscription token, but ONLY after the chat
 * participation check confirms the authenticated subject is a participant of that conversation —
 * the id embedded in the channel string is never trusted as proof of access. The subject is
 * always the caller's own resolved user id.
 */
@Controller('auth/centrifugo')
@UseGuards(JwtAuthGuard)
export class CentrifugoController {
  constructor(
    private readonly tokenService: CentrifugoTokenService,
    private readonly participation: ChatParticipationService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Issue a connection token, or a per-channel subscription token when `channel` is present. */
  @Get('token')
  @HttpCode(HttpStatus.OK)
  async getToken(
    @Req() req: AuthenticatedRequest,
    @Query('channel') channel?: string,
  ): Promise<CentrifugoTokenResponse> {
    const user = await this.resolveUser(req.user.keycloakId);

    if (channel === undefined || channel === '') {
      return { token: this.tokenService.mintConnectionToken(user.id) };
    }

    const conversationId = this.conversationIdFromChannel(channel);
    const allowed =
      conversationId !== null &&
      (await this.participation.isParticipant(user.id, conversationId));
    if (!allowed) {
      throw new ForbiddenException('Not a participant of the requested channel');
    }

    return { token: this.tokenService.mintSubscriptionToken(user.id, channel) };
  }

  /** Extract the conversation id from a `chat:conversation:{id}` channel, or null if malformed. */
  private conversationIdFromChannel(channel: string): string | null {
    if (!channel.startsWith(CHAT_CHANNEL_PREFIX)) {
      return null;
    }
    const id = channel.slice(CHAT_CHANNEL_PREFIX.length);
    return id.length > 0 ? id : null;
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    return user;
  }
}

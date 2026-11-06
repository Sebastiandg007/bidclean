import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { Request } from 'express';
import { Repository } from 'typeorm';

import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { CHAT_HISTORY_PAGE_SIZE } from './chat.constants';
import { CHAT_ERROR_MESSAGES } from './chat.messages';
import { ChatService } from './chat.service';
import {
  ConversationSummaryView,
  ConversationView,
  MessagePage,
  MessageType,
  SendResult,
} from './chat.types';
import { SendMessageDto } from './dto/send-message.dto';
import { SendVoiceMessageDto } from './dto/send-voice-message.dto';
import { PlaybackTarget, UploadTarget } from './voice/voice.types';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * ChatController — REST surface for post-match messaging (JWT-guarded).
 *
 * Opens a conversation for a matched thread, lists the caller's conversations, reads message
 * history via `before`/`after` keyset cursors, and sends messages. Sends require an
 * `Idempotency-Key` header (repo convention) and a `clientMessageId` for idempotent retry /
 * optimistic reconciliation. Participant authorization is enforced in the service by the
 * authenticated subject — never by client-supplied identity.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** POST /chat/threads/:threadId/conversation — open (or get) the matched thread's conversation. */
  @Post('threads/:threadId/conversation')
  @HttpCode(HttpStatus.OK)
  async openConversation(
    @Req() req: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<ConversationView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.chatService.openConversation({ threadId, userId: user.id });
  }

  /** GET /chat/conversations — the caller's conversations, most-recent first. */
  @Get('conversations')
  @HttpCode(HttpStatus.OK)
  async listConversations(
    @Req() req: AuthenticatedRequest,
  ): Promise<ConversationSummaryView[]> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.chatService.listConversations(user.id);
  }

  /** GET /chat/conversations/:id — a single conversation the caller participates in. */
  @Get('conversations/:id')
  @HttpCode(HttpStatus.OK)
  async getConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ConversationView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.chatService.getConversation(id, user.id);
  }

  /** GET /chat/conversations/:id/messages?before=&after=&limit= — keyset history. */
  @Get('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  async getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
  ): Promise<MessagePage> {
    const user = await this.resolveUser(req.user.keycloakId);
    const pageSize = this.parsePageSize(limit);

    if (after !== undefined) {
      return this.chatService.getMessagesAfter(id, user.id, this.parseSeq(after), pageSize);
    }
    const beforeSeq = before !== undefined ? this.parseSeq(before) : null;
    return this.chatService.getMessagesBefore(id, user.id, beforeSeq, pageSize);
  }

  /**
   * POST /chat/conversations/:id/messages — send a message (idempotent by clientMessageId).
   *
   * A `type: 'VOICE'` body is validated as `SendVoiceMessageDto` and routed to the voice send;
   * anything else is a `TEXT` send validated as `SendMessageDto`. The DTO is validated manually
   * (whitelist + forbid-unknown) because the two message kinds carry different shapes on one path.
   */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() raw: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SendResult> {
    if (!idempotencyKey) {
      throw new BadRequestException(CHAT_ERROR_MESSAGES.MISSING_IDEMPOTENCY_KEY);
    }
    const user = await this.resolveUser(req.user.keycloakId);

    if (raw.type === MessageType.VOICE) {
      const dto = await this.validateDto(SendVoiceMessageDto, raw);
      return this.chatService.sendVoiceMessage({
        conversationId: id,
        senderId: user.id,
        clientMessageId: dto.clientMessageId,
        objectKey: dto.objectKey,
        durationMs: dto.durationMs,
        sizeBytes: dto.sizeBytes,
        mimeType: dto.mimeType,
        waveform: dto.waveform ?? null,
      });
    }

    const dto = await this.validateDto(SendMessageDto, raw);
    return this.chatService.sendMessage(id, user.id, dto.clientMessageId, dto.body);
  }

  /**
   * POST /chat/conversations/:id/voice-notes/upload-url — issue an upload grant + pre-signed PUT.
   * Participant + OPEN gated; the server generates the opaque key and persists the grant before
   * minting the URL. The client never chooses the key.
   */
  @Post('conversations/:id/voice-notes/upload-url')
  @HttpCode(HttpStatus.CREATED)
  async createVoiceUploadUrl(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<UploadTarget> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.chatService.createVoiceUploadTarget(id, user.id);
  }

  /**
   * GET /chat/conversations/:id/voice-notes/:messageId/playback-url — mint a fresh playback URL.
   * Authorized by conversation participation; the object key is resolved from the DB by messageId
   * and is never accepted from the client.
   */
  @Get('conversations/:id/voice-notes/:messageId/playback-url')
  @HttpCode(HttpStatus.OK)
  async getVoicePlaybackUrl(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ): Promise<PlaybackTarget> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.chatService.getVoicePlaybackTarget(id, user.id, messageId);
  }

  /** Parse and bound the page size, defaulting to the configured size. */
  private parsePageSize(raw?: string): number {
    if (raw === undefined) {
      return CHAT_HISTORY_PAGE_SIZE;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return CHAT_HISTORY_PAGE_SIZE;
    }
    return Math.min(parsed, CHAT_HISTORY_PAGE_SIZE);
  }

  /** Parse a required non-negative sequence cursor. */
  private parseSeq(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException('Invalid sequence cursor');
    }
    return parsed;
  }

  /**
   * Validate a raw body against a DTO class with whitelist + forbid-unknown semantics (matching
   * the ValidationPipe used elsewhere), throwing `400` on any violation.
   */
  private async validateDto<T extends object>(
    cls: new () => T,
    raw: Record<string, unknown>,
  ): Promise<T> {
    // Strip the discriminator so `forbidNonWhitelisted` does not reject a known `type` field.
    const { type: _type, ...rest } = raw;
    const instance = plainToInstance(cls, rest, { enableImplicitConversion: false });
    try {
      await validateOrReject(instance as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    } catch {
      throw new BadRequestException('Invalid message payload');
    }
    return instance;
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(CHAT_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }
}

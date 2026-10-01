import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { CHAT_HISTORY_PAGE_SIZE } from '../chat.constants';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { EndCallDto } from './dto/end-call.dto';
import { VoipService } from './voip.service';
import { CallView, InitiatedCall, MediaToken, VOIP_ERROR_MESSAGES } from './voip.types';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * VoipController — REST surface for in-conversation calling (JWT-guarded).
 *
 * Extends the chat surface under `/chat/conversations/:id/calls`. Every action authorizes by the
 * authenticated subject resolved to a BidClean user (never client-supplied identity); the service
 * enforces participation, the OPEN-lifecycle rule, the call state machine, and the status+role
 * media-token gate. `initiate`/`answer`/`token` return a short-lived LiveKit token; reads reflect
 * the authoritative PostgreSQL state machine independent of signaling delivery.
 */
@Controller('chat/conversations/:id/calls')
@UseGuards(JwtAuthGuard)
export class VoipController {
  constructor(
    private readonly voipService: VoipService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** POST /chat/conversations/:id/calls — initiate a call (idempotent by clientCallId). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async initiate(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() dto: InitiateCallDto,
  ): Promise<InitiatedCall> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.initiate({
      conversationId,
      callerId: user.id,
      clientCallId: dto.clientCallId,
      mediaKind: dto.mediaKind,
    });
  }

  /** POST /chat/conversations/:id/calls/:callId/answer — answer as the callee; returns a token. */
  @Post(':callId/answer')
  @HttpCode(HttpStatus.OK)
  async answer(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
  ): Promise<MediaToken> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.answer(conversationId, callId, user.id);
  }

  /** POST /chat/conversations/:id/calls/:callId/decline — decline as the callee. */
  @Post(':callId/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
  ): Promise<CallView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.decline(conversationId, callId, user.id);
  }

  /** POST /chat/conversations/:id/calls/:callId/cancel — cancel as the initiator before answer. */
  @Post(':callId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
  ): Promise<CallView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.cancel(conversationId, callId, user.id);
  }

  /** POST /chat/conversations/:id/calls/:callId/end — hang up an ongoing (or ringing) call. */
  @Post(':callId/end')
  @HttpCode(HttpStatus.OK)
  async end(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
    @Body() _dto: EndCallDto,
  ): Promise<CallView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.end(conversationId, callId, user.id);
  }

  /** POST /chat/conversations/:id/calls/:callId/token — mint a media token per the status+role gate. */
  @Post(':callId/token')
  @HttpCode(HttpStatus.OK)
  async token(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
  ): Promise<MediaToken> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.mintMediaToken(conversationId, callId, user.id);
  }

  /** GET /chat/conversations/:id/calls/:callId — the authoritative call state (reconciliation). */
  @Get(':callId')
  @HttpCode(HttpStatus.OK)
  async getCall(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
  ): Promise<CallView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.getCall(conversationId, callId, user.id);
  }

  /** GET /chat/conversations/:id/calls?before=&limit= — call history (missed-call UX). */
  @Get()
  @HttpCode(HttpStatus.OK)
  async listCalls(
    @Req() req: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ): Promise<CallView[]> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.voipService.listCalls(
      conversationId,
      user.id,
      this.parseBefore(before),
      this.parsePageSize(limit),
    );
  }

  /** Parse and bound the page size, defaulting to the configured chat history size. */
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

  /** Parse an optional ISO `before` cursor into a Date, or null for the latest page. */
  private parseBefore(raw?: string): Date | null {
    if (raw === undefined || raw === '') {
      return null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(VOIP_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }
}

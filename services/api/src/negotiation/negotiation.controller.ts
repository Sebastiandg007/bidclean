import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../roles/roles.types';
import { NegotiationService } from './negotiation.service';
import { CreateCounterofferDto } from './dto/create-counteroffer.dto';
import { HostCounterDto } from './dto/host-counter.dto';
import { NEGOTIATION_ERROR_MESSAGES } from './negotiation.messages';
import {
  MatchSummary,
  ProposalView,
  ThreadView,
  HostInboxItem,
} from './negotiation.types';

/** Extended request with typed user payload from JWT guard */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Negotiation controller.
 *
 * Cleaner + Host REST endpoints for the offer negotiation flow:
 * - POST /negotiation/offers/:offerId/accept — Cleaner direct accept
 * - POST /negotiation/offers/:offerId/counteroffers — Cleaner counteroffer
 * - POST /negotiation/proposals/:proposalId/accept|reject|counter — counterparty action
 * - GET  /negotiation/offers/:offerId/thread — Cleaner's own thread
 * - GET  /negotiation/host/counteroffers — Host inbox
 *
 * All endpoints require JWT auth. Mutations require an Idempotency-Key header
 * (400 if missing). Role resolution maps keycloakId -> User and asserts the
 * required role.
 */
@Controller('negotiation')
@UseGuards(JwtAuthGuard)
export class NegotiationController {
  constructor(
    private readonly negotiationService: NegotiationService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** POST /negotiation/offers/:offerId/accept — Cleaner direct accept at Host price. */
  @Post('offers/:offerId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptOffer(
    @Req() req: AuthenticatedRequest,
    @Param('offerId') offerId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<MatchSummary> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const cleaner = await this.resolveCleaner(req.user.keycloakId);
    return this.negotiationService.acceptOffer(cleaner.id, offerId, key);
  }

  /** POST /negotiation/offers/:offerId/counteroffers — Cleaner submits a counteroffer. */
  @Post('offers/:offerId/counteroffers')
  @HttpCode(HttpStatus.CREATED)
  async createCounteroffer(
    @Req() req: AuthenticatedRequest,
    @Param('offerId') offerId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CreateCounterofferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ProposalView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const cleaner = await this.resolveCleaner(req.user.keycloakId);
    return this.negotiationService.createCounteroffer(cleaner.id, offerId, dto, key);
  }

  /** POST /negotiation/proposals/:proposalId/accept — accept counterparty proposal. */
  @Post('proposals/:proposalId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptProposal(
    @Req() req: AuthenticatedRequest,
    @Param('proposalId') proposalId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<MatchSummary> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const user = await this.resolveHostOrCleaner(req.user.keycloakId);
    return this.negotiationService.acceptProposal(user.id, proposalId, key);
  }

  /** POST /negotiation/proposals/:proposalId/reject — reject counterparty proposal. */
  @Post('proposals/:proposalId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectProposal(
    @Req() req: AuthenticatedRequest,
    @Param('proposalId') proposalId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ProposalView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const user = await this.resolveHostOrCleaner(req.user.keycloakId);
    return this.negotiationService.rejectProposal(user.id, proposalId, key);
  }

  /** POST /negotiation/proposals/:proposalId/counter — counter back with a new price. */
  @Post('proposals/:proposalId/counter')
  @HttpCode(HttpStatus.CREATED)
  async counterProposal(
    @Req() req: AuthenticatedRequest,
    @Param('proposalId') proposalId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: HostCounterDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ProposalView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const user = await this.resolveHostOrCleaner(req.user.keycloakId);
    return this.negotiationService.counterProposal(user.id, proposalId, dto, key);
  }

  /** GET /negotiation/offers/:offerId/thread — Cleaner's own thread. */
  @Get('offers/:offerId/thread')
  @HttpCode(HttpStatus.OK)
  async getThread(
    @Req() req: AuthenticatedRequest,
    @Param('offerId') offerId: string,
  ): Promise<ThreadView | null> {
    const cleaner = await this.resolveCleaner(req.user.keycloakId);
    return this.negotiationService.getThreadForCleaner(cleaner.id, offerId);
  }

  /** GET /negotiation/host/counteroffers — Host inbox of pending Cleaner counteroffers. */
  @Get('host/counteroffers')
  @HttpCode(HttpStatus.OK)
  async getHostInbox(@Req() req: AuthenticatedRequest): Promise<HostInboxItem[]> {
    const host = await this.resolveHost(req.user.keycloakId);
    return this.negotiationService.getHostInbox(host.id);
  }

  // ─── Auth helpers ──────────────────────────────────────────────────────────

  /** Require a non-empty Idempotency-Key header. */
  private requireIdempotencyKey(idempotencyKey?: string): string {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException(NEGOTIATION_ERROR_MESSAGES.MISSING_IDEMPOTENCY_KEY);
    }
    return idempotencyKey;
  }

  /** Resolve the user and require the Cleaner role. */
  private async resolveCleaner(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    if (!user.roles.includes(UserRole.CLEANER)) {
      throw new ForbiddenException('Cleaner role required');
    }
    return user;
  }

  /** Resolve the user and require the Host role. */
  private async resolveHost(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    if (!user.roles.includes(UserRole.HOST)) {
      throw new ForbiddenException('Host role required');
    }
    return user;
  }

  /** Resolve the user and require either Host or Cleaner role (counterparty actions). */
  private async resolveHostOrCleaner(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    if (!user.roles.includes(UserRole.HOST) && !user.roles.includes(UserRole.CLEANER)) {
      throw new ForbiddenException('Host or Cleaner role required');
    }
    return user;
  }
}

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';

import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { PositionSampleDto } from './dto/position-sample.dto';
import { PositionRateLimiter } from './position-rate-limiter';
import { ServiceSessionService } from './service-session.service';
import { SERVICE_ERROR_MESSAGES, ServiceSessionView } from './service-tracking.types';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * ServiceSessionController — REST surface for service tracking (JWT-guarded, Spec 17).
 *
 * Every action authorizes by the authenticated subject resolved to a BidClean user (never
 * client-supplied identity); the service enforces participation, the Cleaner role, and the state
 * machine. A non-participant receives `403` and learns nothing about the session's existence. The
 * position endpoint is rate-limited in the controller BEFORE the service runs the eligibility gate /
 * geofence / re-publish (Option A: the Cleaner never publishes to the channel directly). Reads
 * reflect the authoritative PostgreSQL state machine independent of realtime delivery.
 */
@Controller('service-sessions')
@UseGuards(JwtAuthGuard)
export class ServiceSessionController {
  constructor(
    private readonly sessionService: ServiceSessionService,
    private readonly rateLimiter: PositionRateLimiter,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET /service-sessions/:id — participant-gated reconciliation (authoritative state). */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getSession(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
  ): Promise<ServiceSessionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.sessionService.getSession(sessionId, user.id);
  }

  /** POST /service-sessions/:id/en-route — Cleaner marks heading out (MATCHED → EN_ROUTE). */
  @Post(':id/en-route')
  @HttpCode(HttpStatus.OK)
  async startEnRoute(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
  ): Promise<ServiceSessionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.sessionService.startEnRoute(sessionId, user.id);
  }

  /**
   * POST /service-sessions/:id/position — Cleaner reports a position sample. Rate-limited per
   * (user, session) BEFORE evaluation; an over-frequent sample is ignored (returns current state),
   * never errored. The server then gates eligibility, runs the geofence, and re-publishes to the Host.
   */
  @Post(':id/position')
  @HttpCode(HttpStatus.OK)
  async reportPosition(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
    @Body() dto: PositionSampleDto,
  ): Promise<ServiceSessionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    const accepted = await this.rateLimiter.shouldAccept(user.id, sessionId, Date.now());
    if (!accepted) {
      // Throttled: ignore this sample (not an error) and return the authoritative current state.
      return this.sessionService.getSession(sessionId, user.id);
    }
    return this.sessionService.ingestPosition(sessionId, user.id, {
      lat: dto.lat,
      lng: dto.lng,
      accuracy: dto.accuracy,
      heading: dto.heading,
      at: dto.at,
    });
  }

  /** POST /service-sessions/:id/start — Cleaner begins work (ARRIVED → IN_PROGRESS). */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
  ): Promise<ServiceSessionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.sessionService.start(sessionId, user.id);
  }

  /** POST /service-sessions/:id/cancel — explicit participant cancel (CANCELED_BY_PARTICIPANT). */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
  ): Promise<ServiceSessionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.sessionService.cancelByParticipant(sessionId, user.id);
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(SERVICE_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }
}

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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';

import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { COMPLETION_ERROR_MESSAGES, ServiceCompletionView, ServiceRatingView } from './completion.types';
import { CompletionDecisionService } from './service/completion-decision.service';
import { CompletionViewService } from './service/completion-view.service';
import { RatingService } from './service/rating.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * CompletionController — REST surface for service-completion (JWT-guarded, Spec 20).
 *
 * Every action authorizes by the authenticated subject resolved to a BidClean user (never
 * client-supplied identity); the services enforce participation, the Host-only rule, the state
 * machine, and the single-winner transitions. A non-participant receives `403` and learns nothing.
 * `release` is NOT a REST action — it is driven only by the release-intent worker. `GET` exposes the
 * derived `release_status` only (never internal intent fields).
 */
@Controller('service-completions')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class CompletionController {
  constructor(
    private readonly viewService: CompletionViewService,
    private readonly decisionService: CompletionDecisionService,
    private readonly ratingService: RatingService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET — participant-gated reconciliation (state + deadline + rating status + release_status). */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getCompletion(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ServiceCompletionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.viewService.getCompletion(id, user.id);
  }

  /** POST :id/confirm — Host confirms satisfaction (single-winner → CONFIRMED + intent). */
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.decisionService.confirm(id, user.id);
  }

  /** POST :id/dispute — Host opens a pre-release dispute (→ DISPUTED, suppresses auto-release). */
  @Post(':id/dispute')
  @HttpCode(HttpStatus.OK)
  async dispute(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.decisionService.openDispute(id, user.id);
  }

  /** POST :id/post-release-dispute — Host disputes AFTER release (only when release_status=ACCEPTED). */
  @Post(':id/post-release-dispute')
  @HttpCode(HttpStatus.OK)
  async postReleaseDispute(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.decisionService.openPostReleaseDispute(id, user.id);
  }

  /** POST :id/ratings — Host or Cleaner submits one rating side (never gating). */
  @Post(':id/ratings')
  @HttpCode(HttpStatus.CREATED)
  async submitRating(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SubmitRatingDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.ratingService.submitRating(id, user.id, { stars: dto.stars, comment: dto.comment });
  }

  /** GET :id/ratings — participant-gated ratings read. */
  @Get(':id/ratings')
  @HttpCode(HttpStatus.OK)
  async getRatings(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ServiceRatingView[]> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.ratingService.getRatings(id, user.id);
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(COMPLETION_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }
}

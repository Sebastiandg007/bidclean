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
import { AddStructuredEvidenceDto } from './dto/add-structured-evidence.dto';
import { FinalizeEvidenceDto } from './dto/finalize-evidence.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DISPUTE_ERROR_MESSAGES, DisputeView } from './dispute.types';
import { UploadTarget } from './storage/dispute-evidence-storage.service';
import { DisputeEvidenceService, ResolvedEvidence } from './service/dispute-evidence.service';
import { DisputeLifecycleService } from './service/dispute-lifecycle.service';
import { DisputeViewService } from './service/dispute-view.service';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * DisputeController — REST surface for dispute-system (JWT-guarded, Spec 21).
 *
 * There is NO `POST /disputes`: the case is created by service-completion's routing consumer, never a
 * mobile call. Every action authorizes by the authenticated subject resolved to a BidClean user
 * (never client-supplied identity); the services enforce participation, the resolver-only rule, the
 * window gates, and the single-winner transitions. `setDisputeStatus`/refund/release are NOT REST
 * actions — they are driven only by the intent workers. `GET` exposes state/phase/resolution/evidence
 * refs only (never internal intent fields). A non-participant/non-resolver receives `403` and learns
 * nothing.
 */
@Controller('disputes')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class DisputeController {
  constructor(
    private readonly viewService: DisputeViewService,
    private readonly evidenceService: DisputeEvidenceService,
    private readonly lifecycleService: DisputeLifecycleService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET — participant/resolver-gated reconciliation (state + phase + resolution + evidence refs). */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getDispute(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<DisputeView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.viewService.getDispute(id, user.id);
  }

  /** POST :id/evidence/request-upload — participant grant-gated PUT target (window + non-terminal gated). */
  @Post(':id/evidence/request-upload')
  @HttpCode(HttpStatus.CREATED)
  async requestUpload(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<UploadTarget> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.evidenceService.requestUpload(id, user.id);
  }

  /** POST :id/evidence/finalize — participant finalize a photo (grant + window + server-inspect). */
  @Post(':id/evidence/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeUpload(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: FinalizeEvidenceDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.evidenceService.finalizeUpload(id, user.id, { objectKey: dto.objectKey });
  }

  /** POST :id/evidence — participant structured HOST_REASON/NOTE within the window. */
  @Post(':id/evidence')
  @HttpCode(HttpStatus.CREATED)
  async addEvidence(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AddStructuredEvidenceDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.evidenceService.addStructuredEvidence(id, user.id, dto.kind, dto.textValue);
  }

  /** GET :id/evidence/:evidenceId/url — participant/resolver visual URL / structured gated data. */
  @Get(':id/evidence/:evidenceId/url')
  @HttpCode(HttpStatus.OK)
  async resolveEvidence(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ): Promise<ResolvedEvidence> {
    const user = await this.resolveUser(req.user.keycloakId);
    const dispute = await this.viewService.requireViewableDispute(id, user.id);
    return this.evidenceService.resolveEvidence(dispute, user.id, evidenceId);
  }

  /** POST :id/resolve — resolver only (single-winner → RESOLVED + financial intent + outbox). */
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.lifecycleService.resolve(id, user.id, {
      resolution: dto.resolution,
      refundCents: dto.refundCents,
    });
  }

  /** Resolve the Keycloak subject to a BidClean user (403 when unknown). */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(DISPUTE_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }
}

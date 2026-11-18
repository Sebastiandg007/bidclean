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
import { FinalizeUploadDto } from './dto/finalize-upload.dto';
import { VerificationService } from './service/verification.service';
import { UploadTarget, VerificationView } from './video-verification.types';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/** Error message for an unresolvable authenticated subject. */
const USER_NOT_FOUND = 'User not found';

/**
 * VideoVerificationController — REST surface for the on-arrival identity check (JWT-guarded, Spec 18).
 *
 * Every action authorizes by the authenticated subject resolved to a BidClean user (never
 * client-supplied identity); the service enforces participation, the Cleaner role, and the state
 * machine. A non-participant receives `403`/`404` and learns nothing. There is DELIBERATELY NO
 * playback/download route in v1 — the arrival video is never served to any client. Reads reflect
 * the authoritative PostgreSQL state machine and expose only a derived classification (never the
 * raw `match_score`, never a video URL).
 */
@Controller('video-verifications')
@UseGuards(JwtAuthGuard)
export class VideoVerificationController {
  constructor(
    private readonly verificationService: VerificationService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET /video-verifications/:id — participant-gated reconciliation (authoritative state). */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getVerification(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<VerificationView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.verificationService.getVerification(id, user.id);
  }

  /** POST /video-verifications/:id/request-upload — Cleaner + PENDING_UPLOAD gated. */
  @Post(':id/request-upload')
  @HttpCode(HttpStatus.CREATED)
  async requestUpload(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<UploadTarget> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.verificationService.requestUpload(id, user.id);
  }

  /** POST /video-verifications/:id/finalize — Cleaner + grant-gated; body is advisory. */
  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  async finalize(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: FinalizeUploadDto,
  ): Promise<VerificationView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.verificationService.finalizeUpload(id, user.id, dto);
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(USER_NOT_FOUND);
    }
    return user;
  }
}

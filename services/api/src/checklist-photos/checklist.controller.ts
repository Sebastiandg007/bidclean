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
import { CHECKLIST_ERROR_MESSAGES, ChecklistRunView, PlaybackTarget, UploadTarget } from './checklist.types';
import { ChecklistPhotoService } from './service/checklist-photo.service';
import { ChecklistRunService } from './service/checklist-run.service';
import { ChecklistTaskService } from './service/checklist-task.service';
import { FinalizePhotoDto } from './dto/finalize-photo.dto';
import { MarkTaskDto } from './dto/mark-task.dto';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * ChecklistController — REST surface for checklist-photos (JWT-guarded, Spec 19).
 *
 * Routes are nested under `service-sessions/:id/checklist`. Every action authorizes by the
 * authenticated subject resolved to a BidClean user (never client-supplied identity); the services
 * enforce participation, the Cleaner role, the run lifecycle, the count invariant, the per-task
 * cap, and single-winner terminality. A non-participant receives `403` and learns nothing about the
 * run's existence. Photo bytes never transit this controller — the Cleaner PUTs directly to MinIO;
 * playback is a session-scoped pre-signed GET resolved server-side.
 */
@Controller('service-sessions/:id/checklist')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ChecklistController {
  constructor(
    private readonly runService: ChecklistRunService,
    private readonly taskService: ChecklistTaskService,
    private readonly photoService: ChecklistPhotoService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET — participant-gated reconciliation (run + ordered tasks + photo refs, ids not keys). */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getChecklist(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
  ): Promise<ChecklistRunView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.runService.getChecklist(sessionId, user.id);
  }

  /** POST tasks/:taskId — Cleaner marks a task done/undone (ACTIVE + IN_PROGRESS gated). */
  @Post('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markTask(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: MarkTaskDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.taskService.markTask(sessionId, user.id, taskId, dto.done);
  }

  /** POST tasks/:taskId/photo/request-upload — Cleaner reserves a slot + gets a pre-signed PUT. */
  @Post('tasks/:taskId/photo/request-upload')
  @HttpCode(HttpStatus.CREATED)
  async requestUpload(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
    @Param('taskId') taskId: string,
  ): Promise<UploadTarget> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.photoService.requestUpload(sessionId, user.id, taskId);
  }

  /** POST tasks/:taskId/photo/finalize — Cleaner finalizes an uploaded photo (server-inspected). */
  @Post('tasks/:taskId/photo/finalize')
  @HttpCode(HttpStatus.NO_CONTENT)
  async finalizePhoto(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: FinalizePhotoDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.photoService.finalizeUpload(sessionId, user.id, taskId, {
      objectKey: dto.objectKey,
      kind: dto.kind,
    });
  }

  /** GET photos/:photoId/playback-url — participant-gated, session-scoped pre-signed GET. */
  @Get('photos/:photoId/playback-url')
  @HttpCode(HttpStatus.OK)
  async getPlaybackUrl(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
    @Param('photoId') photoId: string,
  ): Promise<PlaybackTarget> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.photoService.getPlaybackUrl(sessionId, user.id, photoId);
  }

  /** POST finalize — Cleaner finalizes the checklist (precondition-gated → COMPLETED + event). */
  @Post('finalize')
  @HttpCode(HttpStatus.NO_CONTENT)
  async finalize(
    @Req() req: AuthenticatedRequest,
    @Param('id') sessionId: string,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.runService.finalize(sessionId, user.id);
  }

  /** Resolve the authenticated Keycloak subject to a BidClean user. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(CHECKLIST_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }
}

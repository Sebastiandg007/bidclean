import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { User } from '../auth/entities/user.entity';
import { NotificationsRepository } from './notifications.repository';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/** The self-scoped preferences view returned to the caller. */
interface PreferencesView {
  readonly categoryOptOut: Record<string, boolean>;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly quietHoursTimezone: string | null;
  readonly language: string | null;
}

/**
 * Preferences controller (self-scoped).
 *
 * `GET`/`PUT /notifications/preferences` read/update the JWT subject's OWN preferences (categories,
 * quiet-hours window + tz, language). Never another user's data.
 */
@Controller('notifications/preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferenceController {
  constructor(
    private readonly repo: NotificationsRepository,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET /notifications/preferences — the caller's current preferences (defaults when unset). */
  @Get()
  @HttpCode(HttpStatus.OK)
  async get(@Req() req: AuthenticatedRequest): Promise<PreferencesView> {
    const user = await this.resolveUser(req.user.keycloakId);
    const prefs = await this.repo.findPreferences(user.id);
    return {
      categoryOptOut: prefs?.categoryOptOut ?? {},
      quietHoursStart: prefs?.quietHoursStart ?? null,
      quietHoursEnd: prefs?.quietHoursEnd ?? null,
      quietHoursTimezone: prefs?.quietHoursTimezone ?? null,
      language: prefs?.language ?? null,
    };
  }

  /** PUT /notifications/preferences — upsert the caller's preferences. */
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(@Req() req: AuthenticatedRequest, @Body() dto: UpdatePreferencesDto): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.repo.upsertPreferences(user.id, {
      categoryOptOut: dto.categoryOptOut ?? {},
      quietHoursStart: dto.quietHoursStart ?? null,
      quietHoursEnd: dto.quietHoursEnd ?? null,
      quietHoursTimezone: dto.quietHoursTimezone ?? null,
      language: dto.language ?? null,
    });
  }

  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    return user;
  }
}

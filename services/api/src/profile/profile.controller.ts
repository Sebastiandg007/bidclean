import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotImplementedException,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ProfileService } from './profile.service';
import { ProfilePhotoService } from './photo/profile-photo.service';
import { PortfolioService } from './portfolio/portfolio.service';
import { PortfolioUploadResult } from './portfolio/portfolio.types';
import { SettingsService } from './settings/settings.service';
import { AccountService } from './account/account.service';
import { CompletenessService } from './completeness/completeness.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UploadPhotoDto } from './dto/upload-photo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { OnboardingGateGuard, RequireOnboarding } from '../roles/guards';
import { UserRole } from '../roles/roles.types';
import { PrivateProfile, ProfileCompleteness } from './profile.types';
import { PublicProfileDto } from './dto/public-profile.dto';
import { UserSettings } from './entities/user-settings.entity';
import { UserSettingsResponse, ThemeOption } from './settings/settings.types';

/**
 * Profile controller.
 * Exposes all profile-related endpoints: CRUD, photo, portfolio,
 * settings, account operations, and completeness.
 */
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly profilePhotoService: ProfilePhotoService,
    private readonly portfolioService: PortfolioService,
    private readonly settingsService: SettingsService,
    private readonly accountService: AccountService,
    private readonly completenessService: CompletenessService,
  ) {}

  /** GET /profile/me — full private profile */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<PrivateProfile> {
    return this.profileService.getPrivateProfile(req.user.keycloakId);
  }

  /** PATCH /profile/me — update common fields */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMyProfile(
    @Req() req: Request & { user: JwtUserPayload },
    @Body() dto: UpdateProfileDto,
  ): Promise<PrivateProfile> {
    return this.profileService.updateCommonProfile(req.user.keycloakId, dto);
  }

  /** PATCH /profile/me/host — update host-specific fields */
  @Patch('me/host')
  @UseGuards(JwtAuthGuard, OnboardingGateGuard)
  @RequireOnboarding(UserRole.HOST)
  async updateHostProfile(
    @Req() req: Request & { user: JwtUserPayload },
    @Body() dto: UpdateHostProfileDto,
  ): Promise<PrivateProfile> {
    return this.profileService.updateHostProfile(req.user.keycloakId, dto);
  }

  /** PATCH /profile/me/cleaner — update cleaner-specific fields */
  @Patch('me/cleaner')
  @UseGuards(JwtAuthGuard, OnboardingGateGuard)
  @RequireOnboarding(UserRole.CLEANER)
  async updateCleanerProfile(
    @Req() req: Request & { user: JwtUserPayload },
    @Body() dto: UpdateCleanerProfileDto,
  ): Promise<PrivateProfile> {
    return this.profileService.updateCleanerProfile(req.user.keycloakId, dto);
  }

  /** POST /profile/me/photo — upload profile photo */
  @Post('me/photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Req() req: Request & { user: JwtUserPayload },
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PrivateProfile> {
    if (!file) {
      throw new BadRequestException('profile.error.no_file_provided');
    }

    const userId = await this.profileService.findUserIdByKeycloakId(
      req.user.keycloakId,
    );

    await this.profilePhotoService.uploadPhoto(
      userId,
      file.buffer,
      file.mimetype,
    );

    return this.profileService.getPrivateProfile(req.user.keycloakId);
  }

  /** DELETE /profile/me/photo — remove profile photo */
  @Delete('me/photo')
  @UseGuards(JwtAuthGuard)
  async deletePhoto(
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<PrivateProfile> {
    const userId = await this.profileService.findUserIdByKeycloakId(
      req.user.keycloakId,
    );

    await this.profilePhotoService.deletePhoto(userId);

    return this.profileService.getPrivateProfile(req.user.keycloakId);
  }

  /** GET /profile/me/completeness — profile completeness percentage */
  @Get('me/completeness')
  @UseGuards(JwtAuthGuard)
  async getCompleteness(
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<ProfileCompleteness> {
    const { id, activeRole } = await this.profileService.findUserWithRole(
      req.user.keycloakId,
    );

    if (!activeRole) {
      throw new BadRequestException('profile.error.no_active_role');
    }

    return this.completenessService.calculateCompleteness(id, activeRole);
  }

  /** GET /profile/:userId — public profile */
  @Get(':userId')
  @UseGuards(JwtAuthGuard)
  async getPublicProfile(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ): Promise<PublicProfileDto> {
    const publicProfile = await this.profileService.getPublicProfile(userId);
    return publicProfile as PublicProfileDto;
  }

  /** POST /profile/me/portfolio — upload portfolio photo */
  @Post('me/portfolio')
  @UseGuards(JwtAuthGuard, OnboardingGateGuard)
  @RequireOnboarding(UserRole.CLEANER)
  @UseInterceptors(FileInterceptor('file'))
  async uploadPortfolioPhoto(
    @Req() req: Request & { user: JwtUserPayload },
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadPhotoDto,
  ): Promise<PortfolioUploadResult> {
    if (!file) {
      throw new BadRequestException('profile.error.no_file_provided');
    }

    const userId = await this.profileService.findUserIdByKeycloakId(
      req.user.keycloakId,
    );

    return this.portfolioService.uploadPhoto(
      userId,
      file.buffer,
      file.mimetype,
      dto.caption,
    );
  }

  /** DELETE /profile/me/portfolio/:photoId — remove portfolio photo */
  @Delete('me/portfolio/:photoId')
  @UseGuards(JwtAuthGuard, OnboardingGateGuard)
  @RequireOnboarding(UserRole.CLEANER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePortfolioPhoto(
    @Req() req: Request & { user: JwtUserPayload },
    @Param('photoId', new ParseUUIDPipe({ version: '4' })) photoId: string,
  ): Promise<void> {
    const userId = await this.profileService.findUserIdByKeycloakId(
      req.user.keycloakId,
    );

    await this.portfolioService.deletePhoto(userId, photoId);
  }

  /** GET /profile/me/settings — get user settings */
  @Get('me/settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<UserSettingsResponse> {
    const userId = await this.profileService.findUserIdByKeycloakId(
      req.user.keycloakId,
    );
    const settings = await this.settingsService.getSettings(userId);

    return this.mapSettingsToResponse(settings);
  }

  /** PATCH /profile/me/settings — update user settings */
  @Patch('me/settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(
    @Req() req: Request & { user: JwtUserPayload },
    @Body() dto: UpdateSettingsDto,
  ): Promise<UserSettingsResponse> {
    const userId = await this.profileService.findUserIdByKeycloakId(
      req.user.keycloakId,
    );
    const updated = await this.settingsService.updateSettings(userId, dto);

    return this.mapSettingsToResponse(updated);
  }

  /** Maps UserSettings entity to response (excludes internal fields). */
  private mapSettingsToResponse(settings: UserSettings): UserSettingsResponse {
    return {
      language: settings.language,
      theme: settings.theme as ThemeOption,
      isPushEnabled: settings.isPushEnabled,
      isEmailNotificationsEnabled: settings.isEmailNotificationsEnabled,
      isSoundsEnabled: settings.isSoundsEnabled,
    };
  }

  /** POST /profile/me/change-email — get Keycloak email change URL */
  @Post('me/change-email')
  async changeEmail(@Req() _req: Request): Promise<unknown> {
    void this.accountService;
    throw new NotImplementedException();
  }

  /** POST /profile/me/change-password — get Keycloak password change URL */
  @Post('me/change-password')
  async changePassword(@Req() _req: Request): Promise<unknown> {
    throw new NotImplementedException();
  }

  /** POST /profile/me/delete-account — request account deletion */
  @Post('me/delete-account')
  async deleteAccount(
    @Req() _req: Request,
    @Body() _dto: DeleteAccountDto,
  ): Promise<unknown> {
    throw new NotImplementedException();
  }
}

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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ProfileService } from './profile.service';
import { ProfilePhotoService } from './photo/profile-photo.service';
import { PortfolioService } from './portfolio/portfolio.service';
import { SettingsService } from './settings/settings.service';
import { AccountService } from './account/account.service';
import { CompletenessService } from './completeness/completeness.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateHostProfileDto } from './dto/update-host-profile.dto';
import { UpdateCleanerProfileDto } from './dto/update-cleaner-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { OnboardingGateGuard, RequireOnboarding } from '../roles/guards';
import { UserRole } from '../roles/roles.types';
import { PrivateProfile } from './profile.types';

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
  async getCompleteness(@Req() _req: Request): Promise<unknown> {
    void this.completenessService;
    throw new NotImplementedException();
  }

  /** GET /profile/:userId — public profile */
  @Get(':userId')
  async getPublicProfile(@Param('userId') _userId: string): Promise<unknown> {
    throw new NotImplementedException();
  }

  /** POST /profile/me/portfolio — upload portfolio photo */
  @Post('me/portfolio')
  async uploadPortfolioPhoto(@Req() _req: Request): Promise<unknown> {
    void this.portfolioService;
    throw new NotImplementedException();
  }

  /** DELETE /profile/me/portfolio/:photoId — remove portfolio photo */
  @Delete('me/portfolio/:photoId')
  async deletePortfolioPhoto(
    @Req() _req: Request,
    @Param('photoId') _photoId: string,
  ): Promise<unknown> {
    throw new NotImplementedException();
  }

  /** GET /profile/me/settings — get user settings */
  @Get('me/settings')
  async getSettings(@Req() _req: Request): Promise<unknown> {
    void this.settingsService;
    throw new NotImplementedException();
  }

  /** PATCH /profile/me/settings — update user settings */
  @Patch('me/settings')
  async updateSettings(
    @Req() _req: Request,
    @Body() _dto: UpdateSettingsDto,
  ): Promise<unknown> {
    throw new NotImplementedException();
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

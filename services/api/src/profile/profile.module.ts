import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import { ProfilePhotoService } from './photo/profile-photo.service';
import { PortfolioService } from './portfolio/portfolio.service';
import { SettingsService } from './settings/settings.service';
import { AccountService } from './account/account.service';
import { DeletionJobProcessor } from './account/deletion-job.processor';
import { CompletenessService } from './completeness/completeness.service';
import { CompletenessWeightValidator } from './completeness/completeness-weight.validator';
import { KeycloakEmailController } from './webhooks/keycloak-email.controller';
import { KeycloakEmailService } from './webhooks/keycloak-email.service';
import { ProfileDetails } from './entities/profile-details.entity';
import { UserSettings } from './entities/user-settings.entity';
import { PortfolioPhoto } from './entities/portfolio-photo.entity';
import { User } from '../auth/entities/user.entity';
import { HostProfile } from '../roles/entities/host-profile.entity';
import { CleanerProfile } from '../roles/entities/cleaner-profile.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * Profile module.
 *
 * Manages user profile CRUD (split PATCH endpoints for common/host/cleaner fields),
 * profile photo storage, portfolio management, settings, profile completeness,
 * account operations (email/password via Keycloak, async deletion via BullMQ),
 * and Keycloak email webhook listener.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ProfileDetails,
      UserSettings,
      PortfolioPhoto,
      User,
      HostProfile,
      CleanerProfile,
    ]),
    BullModule.registerQueue({ name: 'account-deletion' }),
    AuthModule,
  ],
  controllers: [ProfileController, KeycloakEmailController],
  providers: [
    ProfileService,
    ProfileRepository,
    ProfilePhotoService,
    PortfolioService,
    SettingsService,
    AccountService,
    DeletionJobProcessor,
    CompletenessService,
    CompletenessWeightValidator,
    KeycloakEmailService,
  ],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}

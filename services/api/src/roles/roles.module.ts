import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { OnboardingGateGuard } from './guards/onboarding-gate.guard';
import { HostProfile } from './entities/host-profile.entity';
import { CleanerProfile } from './entities/cleaner-profile.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * Roles module.
 *
 * Handles user role assignment (Host/Cleaner), role switching,
 * role-specific onboarding profiles, and onboarding status.
 * Exports OnboardingGateGuard for use by other modules that need
 * to gate access behind onboarding completion.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, HostProfile, CleanerProfile]),
    AuthModule,
  ],
  controllers: [RolesController],
  providers: [RolesService, OnboardingGateGuard],
  exports: [RolesService, OnboardingGateGuard],
})
export class RolesModule {}

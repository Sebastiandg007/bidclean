import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { HostProfile } from './entities/host-profile.entity';
import { CleanerProfile } from './entities/cleaner-profile.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * Roles module.
 *
 * Handles user role assignment (Host/Cleaner), role switching,
 * role-specific onboarding profiles, and onboarding status.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, HostProfile, CleanerProfile]),
    AuthModule,
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}

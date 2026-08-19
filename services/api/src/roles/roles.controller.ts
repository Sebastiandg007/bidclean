import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { RolesService } from './roles.service';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { SwitchActiveRoleDto } from './dto/switch-active-role.dto';
import { HostProfileDto } from './dto/host-profile.dto';
import { CleanerProfileDto } from './dto/cleaner-profile.dto';
import {
  AssignRolesResponse,
  OnboardingStatusResponse,
  SwitchRoleResponse,
  UserRolesResponse,
} from './roles.types';
import { HostProfile } from './entities/host-profile.entity';
import { CleanerProfile } from './entities/cleaner-profile.entity';

/** Extended request with typed user payload from JWT guard */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Roles controller.
 *
 * Handles role assignment, role switching, onboarding profiles,
 * and onboarding status queries.
 * All endpoints require a valid JWT access token.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * POST /users/roles
   * Assign one or both roles to the authenticated user.
   */
  @Post('roles')
  async assignRoles(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: AssignRolesDto,
  ): Promise<AssignRolesResponse> {
    return this.rolesService.assignRoles(req.user.keycloakId, dto);
  }

  /**
   * GET /users/me/roles
   * Get the authenticated user's assigned roles and active role.
   */
  @Get('me/roles')
  async getUserRoles(@Req() req: AuthenticatedRequest): Promise<UserRolesResponse> {
    return this.rolesService.getUserRoles(req.user.keycloakId);
  }

  /**
   * PATCH /users/me/active-role
   * Switch the authenticated user's active role.
   */
  @Patch('me/active-role')
  async switchActiveRole(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: SwitchActiveRoleDto,
  ): Promise<SwitchRoleResponse> {
    return this.rolesService.switchActiveRole(req.user.keycloakId, dto.activeRole);
  }

  /**
   * POST /users/me/host-profile
   * Save Host onboarding profile data.
   */
  @Post('me/host-profile')
  async saveHostProfile(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: HostProfileDto,
  ): Promise<HostProfile> {
    return this.rolesService.saveHostProfile(req.user.keycloakId, dto);
  }

  /**
   * POST /users/me/cleaner-profile
   * Save Cleaner onboarding profile data.
   */
  @Post('me/cleaner-profile')
  async saveCleanerProfile(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CleanerProfileDto,
  ): Promise<CleanerProfile> {
    return this.rolesService.saveCleanerProfile(req.user.keycloakId, dto);
  }

  /**
   * GET /users/me/onboarding-status
   * Get onboarding completion status per role.
   */
  @Get('me/onboarding-status')
  async getOnboardingStatus(@Req() req: AuthenticatedRequest): Promise<OnboardingStatusResponse> {
    return this.rolesService.getOnboardingStatus(req.user.keycloakId);
  }
}

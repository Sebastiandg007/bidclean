import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HostProfile } from './entities/host-profile.entity';
import { CleanerProfile } from './entities/cleaner-profile.entity';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { HostProfileDto } from './dto/host-profile.dto';
import { CleanerProfileDto } from './dto/cleaner-profile.dto';
import {
  AssignRolesResponse,
  OnboardingStatusResponse,
  SwitchRoleResponse,
  UserRole,
  UserRolesResponse,
} from './roles.types';

/**
 * Roles service.
 *
 * Handles role assignment, role switching, profile creation,
 * and onboarding status tracking.
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(HostProfile)
    private readonly hostProfileRepository: Repository<HostProfile>,
    @InjectRepository(CleanerProfile)
    private readonly cleanerProfileRepository: Repository<CleanerProfile>,
  ) {}

  /**
   * Assign one or both roles to a user.
   * Idempotent: re-assigning an existing role returns success without duplicates.
   */
  async assignRoles(_userId: string, _dto: AssignRolesDto): Promise<AssignRolesResponse> {
    // TODO: Implement in task 3 — will use hostProfileRepository and cleanerProfileRepository
    void this.hostProfileRepository;
    void this.cleanerProfileRepository;
    throw new Error('Not implemented');
  }

  /**
   * Get the user's assigned roles and current active role.
   */
  async getUserRoles(_userId: string): Promise<UserRolesResponse> {
    // TODO: Implement in task 4
    throw new Error('Not implemented');
  }

  /**
   * Switch the user's active role.
   * Validates that the target role is actually assigned to the user.
   */
  async switchActiveRole(_userId: string, _role: UserRole): Promise<SwitchRoleResponse> {
    // TODO: Implement in task 5
    throw new Error('Not implemented');
  }

  /**
   * Create or update the Host onboarding profile.
   * Requires the user to have the Host role assigned.
   */
  async saveHostProfile(_userId: string, _dto: HostProfileDto): Promise<HostProfile> {
    // TODO: Implement in task 6
    throw new Error('Not implemented');
  }

  /**
   * Create or update the Cleaner onboarding profile.
   * Requires the user to have the Cleaner role assigned.
   */
  async saveCleanerProfile(_userId: string, _dto: CleanerProfileDto): Promise<CleanerProfile> {
    // TODO: Implement in task 7
    throw new Error('Not implemented');
  }

  /**
   * Get onboarding completion status for each role.
   * Status is inferred from profile data completeness.
   */
  async getOnboardingStatus(_userId: string): Promise<OnboardingStatusResponse> {
    // TODO: Implement in task 8
    throw new Error('Not implemented');
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { HostProfile } from './entities/host-profile.entity';
import { CleanerProfile } from './entities/cleaner-profile.entity';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { HostProfileDto } from './dto/host-profile.dto';
import { CleanerProfileDto } from './dto/cleaner-profile.dto';
import {
  AssignRolesResponse,
  OnboardingStatus,
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(HostProfile)
    private readonly hostProfileRepository: Repository<HostProfile>,
    @InjectRepository(CleanerProfile)
    private readonly cleanerProfileRepository: Repository<CleanerProfile>,
  ) {}

  /**
   * Assign one or both roles to a user.
   * Idempotent: re-assigning an existing role returns success without duplicates.
   */
  async assignRoles(keycloakId: string, dto: AssignRolesDto): Promise<AssignRolesResponse> {
    const user = await this.findUserOrFail(keycloakId);
    const previousRoles = [...user.roles];

    user.roles = this.mergeRoles(previousRoles, dto.roles);
    this.initializeOnboardingStatuses(user, previousRoles, dto.roles);
    this.setActiveRoleIfMissing(user);

    await this.userRepository.save(user);

    return {
      roles: user.roles as UserRole[],
      activeRole: user.activeRole as UserRole,
      message: 'Roles assigned successfully',
    };
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
    void this.hostProfileRepository;
    throw new Error('Not implemented');
  }

  /**
   * Create or update the Cleaner onboarding profile.
   * Requires the user to have the Cleaner role assigned.
   */
  async saveCleanerProfile(_userId: string, _dto: CleanerProfileDto): Promise<CleanerProfile> {
    // TODO: Implement in task 7
    void this.cleanerProfileRepository;
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

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  /** Find a user by keycloakId or throw NotFoundException. */
  private async findUserOrFail(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new NotFoundException(`User with keycloakId "${keycloakId}" not found`);
    }

    return user;
  }

  /** Merge new roles into existing roles without duplicates. */
  private mergeRoles(existing: string[], incoming: UserRole[]): string[] {
    const merged = new Set([...existing, ...incoming]);
    return [...merged];
  }

  /** Set onboarding status to IN_PROGRESS for newly assigned roles. */
  private initializeOnboardingStatuses(
    user: User,
    previousRoles: string[],
    incomingRoles: UserRole[],
  ): void {
    const isNewHost =
      incomingRoles.includes(UserRole.HOST) && !previousRoles.includes(UserRole.HOST);
    const isNewCleaner =
      incomingRoles.includes(UserRole.CLEANER) && !previousRoles.includes(UserRole.CLEANER);

    if (isNewHost) {
      user.onboardingStatusHost = OnboardingStatus.IN_PROGRESS;
    }
    if (isNewCleaner) {
      user.onboardingStatusCleaner = OnboardingStatus.IN_PROGRESS;
    }
  }

  /** Set activeRole to the first assigned role if not already set. */
  private setActiveRoleIfMissing(user: User): void {
    if (user.activeRole === null && user.roles.length > 0) {
      user.activeRole = user.roles[0] as string;
    }
  }
}

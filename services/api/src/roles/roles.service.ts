import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  async getUserRoles(keycloakId: string): Promise<UserRolesResponse> {
    const user = await this.findUserOrFail(keycloakId);

    return {
      roles: user.roles as UserRole[],
      activeRole: user.activeRole as UserRole | null,
    };
  }

  /**
   * Switch the user's active role.
   * Validates that the target role is actually assigned to the user.
   * Idempotent: switching to the already-active role returns success.
   */
  async switchActiveRole(keycloakId: string, role: UserRole): Promise<SwitchRoleResponse> {
    const user = await this.findUserOrFail(keycloakId);

    this.validateRoleIsAssigned(user, role);

    user.activeRole = role;
    await this.userRepository.save(user);

    return {
      activeRole: role,
      message: `Active role switched to '${role}'`,
    };
  }

  /**
   * Create or update the Host onboarding profile.
   * Requires the user to have the Host role assigned.
   * Uses upsert behavior: creates if not exists, updates if exists.
   */
  async saveHostProfile(keycloakId: string, dto: HostProfileDto): Promise<HostProfile> {
    const user = await this.findUserOrFail(keycloakId);

    this.validateHostRoleAssigned(user);
    this.validateBusinessFields(dto);

    const profile = await this.upsertHostProfile(user.id, dto);
    return profile;
  }

  /**
   * Create or update the Cleaner onboarding profile.
   * Requires the user to have the Cleaner role assigned.
   * Uses upsert behavior: creates if not exists, updates if exists.
   */
  async saveCleanerProfile(keycloakId: string, dto: CleanerProfileDto): Promise<CleanerProfile> {
    const user = await this.findUserOrFail(keycloakId);

    this.validateCleanerRoleAssigned(user);

    const profile = await this.upsertCleanerProfile(user.id, dto);
    return profile;
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

  /** Validate that the target role is assigned to the user. */
  private validateRoleIsAssigned(user: User, role: UserRole): void {
    if (!user.roles.includes(role)) {
      throw new BadRequestException(`Role '${role}' is not assigned to this user`);
    }
  }

  /** Validate user has the Host role assigned (403 if not). */
  private validateHostRoleAssigned(user: User): void {
    if (!user.roles.includes(UserRole.HOST)) {
      throw new ForbiddenException(
        `Role '${UserRole.HOST}' is required to access this resource`,
      );
    }
  }

  /** Validate business name is provided when isBusiness is true. */
  private validateBusinessFields(dto: HostProfileDto): void {
    if (dto.isBusiness && !dto.businessName) {
      throw new BadRequestException(
        'Business name is required when isBusiness is true',
      );
    }
  }

  /** Create or update the host profile for a given user. */
  private async upsertHostProfile(userId: string, dto: HostProfileDto): Promise<HostProfile> {
    const existing = await this.hostProfileRepository.findOne({
      where: { userId },
    });

    const profile = existing ?? this.hostProfileRepository.create({ userId });

    profile.displayName = dto.displayName;
    profile.isBusiness = dto.isBusiness ?? false;
    profile.businessName = dto.isBusiness ? (dto.businessName ?? null) : null;
    profile.paymentMethodAdded = dto.paymentMethodAdded ?? false;

    return this.hostProfileRepository.save(profile);
  }

  /** Validate user has the Cleaner role assigned (403 if not). */
  private validateCleanerRoleAssigned(user: User): void {
    if (!user.roles.includes(UserRole.CLEANER)) {
      throw new ForbiddenException(
        `Role '${UserRole.CLEANER}' is required to access this resource`,
      );
    }
  }

  /** Create or update the cleaner profile for a given user. */
  private async upsertCleanerProfile(
    userId: string,
    dto: CleanerProfileDto,
  ): Promise<CleanerProfile> {
    const existing = await this.cleanerProfileRepository.findOne({
      where: { userId },
    });

    const profile = existing ?? this.cleanerProfileRepository.create({ userId });

    profile.displayName = dto.displayName;
    profile.workZoneLat = dto.workZoneLat ?? profile.workZoneLat ?? null;
    profile.workZoneLng = dto.workZoneLng ?? profile.workZoneLng ?? null;
    profile.workZoneRadiusKm = dto.workZoneRadiusKm ?? profile.workZoneRadiusKm ?? null;
    profile.availability = dto.availability ?? profile.availability ?? {};
    profile.specialties = dto.specialties ?? profile.specialties ?? [];

    return this.cleanerProfileRepository.save(profile);
  }
}

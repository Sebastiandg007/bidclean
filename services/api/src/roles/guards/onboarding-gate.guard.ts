import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { OnboardingStatus, UserRole } from '../roles.types';
import { ONBOARDING_ROLE_KEY } from './require-onboarding.decorator';

const ONBOARDING_INCOMPLETE_MESSAGE = 'Complete onboarding to access this feature';

/**
 * Guard that blocks access to role-specific endpoints when onboarding is incomplete.
 *
 * Must be used AFTER JwtAuthGuard so that `request.user` is available.
 * Reads the required role from @RequireOnboarding() metadata.
 *
 * Checks:
 * 1. The user has the required role assigned (roles[] array).
 * 2. The user's onboarding for that role is COMPLETED.
 *
 * If no specific role is set via decorator, falls back to the user's active_role.
 */
@Injectable()
export class OnboardingGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.getRequiredRole(context);
    const request = context.switchToHttp().getRequest<Request & { user: JwtUserPayload }>();
    const user = await this.findUser(request.user.keycloakId);

    const roleToCheck = requiredRole ?? (user.activeRole as UserRole | null);

    if (!roleToCheck) {
      throw new ForbiddenException(ONBOARDING_INCOMPLETE_MESSAGE);
    }

    this.validateRoleAssigned(user, roleToCheck);
    this.validateOnboardingCompleted(user, roleToCheck);

    return true;
  }

  /** Extract the required role from handler metadata set by @RequireOnboarding(). */
  private getRequiredRole(context: ExecutionContext): UserRole | null {
    return this.reflector.getAllAndOverride<UserRole | null>(ONBOARDING_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  /** Fetch the user entity from the database. */
  private async findUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException(ONBOARDING_INCOMPLETE_MESSAGE);
    }

    return user;
  }

  /** Verify the user has the required role in their roles array. */
  private validateRoleAssigned(user: User, role: UserRole): void {
    if (!user.roles.includes(role)) {
      throw new ForbiddenException(ONBOARDING_INCOMPLETE_MESSAGE);
    }
  }

  /** Verify the user's onboarding status for the given role is COMPLETED. */
  private validateOnboardingCompleted(user: User, role: UserRole): void {
    const status = this.getOnboardingStatus(user, role);

    if (status !== OnboardingStatus.COMPLETED) {
      throw new ForbiddenException(ONBOARDING_INCOMPLETE_MESSAGE);
    }
  }

  /** Get the onboarding status field for the given role. */
  private getOnboardingStatus(user: User, role: UserRole): string {
    switch (role) {
      case UserRole.HOST:
        return user.onboardingStatusHost;
      case UserRole.CLEANER:
        return user.onboardingStatusCleaner;
    }
  }
}

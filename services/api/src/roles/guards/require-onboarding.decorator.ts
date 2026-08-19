import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { UserRole } from '../roles.types';

/**
 * Metadata key used to store the required onboarding role.
 * Consumed by OnboardingGateGuard to determine which role's onboarding to check.
 */
export const ONBOARDING_ROLE_KEY = 'onboarding_role';

/**
 * Decorator that marks an endpoint as requiring completed onboarding for a specific role.
 *
 * If no role is specified, the guard falls back to the user's current active_role.
 *
 * @example
 * // Require Host onboarding to be completed
 * @RequireOnboarding(UserRole.HOST)
 * @Get('properties')
 * getProperties() { ... }
 *
 * @example
 * // Fall back to user's active_role
 * @RequireOnboarding()
 * @Get('dashboard')
 * getDashboard() { ... }
 */
export const RequireOnboarding = (role?: UserRole): CustomDecorator<string> =>
  SetMetadata(ONBOARDING_ROLE_KEY, role ?? null);

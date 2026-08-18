/**
 * Role-related type definitions for the BidClean platform.
 */

/** Available user roles in BidClean */
export enum UserRole {
  HOST = 'host',
  CLEANER = 'cleaner',
}

/** Onboarding completion status per role */
export enum OnboardingStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

/** Response shape for GET /users/me/roles */
export interface UserRolesResponse {
  readonly roles: UserRole[];
  readonly activeRole: UserRole | null;
}

/** Response shape for GET /users/me/onboarding-status */
export interface OnboardingStatusResponse {
  readonly host: OnboardingStatus;
  readonly cleaner: OnboardingStatus;
}

/** Response shape after assigning roles */
export interface AssignRolesResponse {
  readonly roles: UserRole[];
  readonly activeRole: UserRole;
  readonly message: string;
}

/** Response shape after switching active role */
export interface SwitchRoleResponse {
  readonly activeRole: UserRole;
  readonly message: string;
}

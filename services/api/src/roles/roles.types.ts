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

/** Step completion details for Host onboarding */
export interface HostOnboardingSteps {
  readonly displayNameConfirmed: boolean;
  readonly paymentMethodAdded: boolean;
}

/** Step completion details for Cleaner onboarding */
export interface CleanerOnboardingSteps {
  readonly kycStarted: boolean;
  readonly workZoneSet: boolean;
  readonly availabilitySet: boolean;
}

/** Onboarding status detail for a specific role */
export interface RoleOnboardingDetail<TSteps> {
  readonly status: OnboardingStatus;
  readonly steps: TSteps;
}

/** Response shape for GET /users/me/onboarding-status */
export interface OnboardingStatusResponse {
  readonly host: RoleOnboardingDetail<HostOnboardingSteps> | null;
  readonly cleaner: RoleOnboardingDetail<CleanerOnboardingSteps> | null;
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

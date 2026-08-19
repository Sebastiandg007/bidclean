/**
 * Navigation and prop types for the roles screen flow.
 *
 * Roles flow: RoleSelection → HostOnboarding / CleanerOnboarding → Main App
 */

/** Available user roles in BidClean */
export type UserRole = 'host' | 'cleaner';

/** Callback props for the RoleSelectionScreen */
export interface RoleSelectionScreenProps {
  /** Called when user submits their role selection */
  onSubmit?: (roles: UserRole[]) => void;
  /** Called each time a role card is toggled (for analytics/tracking) */
  onRoleToggled?: (role: UserRole, selected: boolean) => void;
}

/** Callback props for the HostOnboardingScreen (placeholder for task 13) */
export interface HostOnboardingScreenProps {
  /** Called when host onboarding is completed successfully */
  onComplete?: () => void;
  /** Called when user skips optional steps */
  onSkip?: () => void;
}

/** Callback props for the CleanerOnboardingScreen (placeholder for task 14) */
export interface CleanerOnboardingScreenProps {
  /** Called when cleaner onboarding is completed successfully */
  onComplete?: () => void;
  /** Called when user skips optional steps */
  onSkip?: () => void;
}

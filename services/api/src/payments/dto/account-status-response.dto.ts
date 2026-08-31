/** Cleaner Stripe Connected Account status (no secrets) */
export interface AccountStatusResponseDto {
  readonly hasAccount: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly country: string | null;
  readonly defaultCurrency: string | null;
}

/** Onboarding link response */
export interface OnboardingResponseDto {
  readonly onboardingUrl: string;
}

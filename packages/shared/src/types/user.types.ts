/**
 * User-related type definitions shared across the platform.
 */

export const UserRole = {
  HOST: 'host',
  CLEANER: 'cleaner',
} as const;

export type UserRole = typeof UserRole[keyof typeof UserRole];

export const SubscriptionTier = {
  FREE: 'free',
  PRO: 'pro',
} as const;

export type SubscriptionTier = typeof SubscriptionTier[keyof typeof SubscriptionTier];

export const KycStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const;

export type KycStatus = typeof KycStatus[keyof typeof KycStatus];

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly subscriptionTier: SubscriptionTier;
  readonly kycStatus: KycStatus;
  readonly isVerified: boolean;
  readonly language: string;
  readonly country: string;
  readonly createdAt: string;
}

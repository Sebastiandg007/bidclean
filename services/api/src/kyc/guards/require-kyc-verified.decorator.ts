import { applyDecorators, UseGuards } from '@nestjs/common';
import { KycVerifiedGuard } from './kyc-verified.guard';

/**
 * Decorator that enforces KYC verification for Cleaners on the decorated endpoint.
 *
 * Applies KycVerifiedGuard which checks the latest kyc_verifications record.
 * Must be used on endpoints where JwtAuthGuard is already applied.
 *
 * @example
 * @RequireKycVerified()
 * @Post('offers/:id/accept')
 * acceptOffer() { ... }
 */
export const RequireKycVerified = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(KycVerifiedGuard));

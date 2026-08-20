import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycStatus } from '../kyc.types';

/** i18n key for KYC not verified error */
const KYC_NOT_VERIFIED_MESSAGE = 'kyc.error.not_verified';

/**
 * Guard that blocks offer acceptance for Cleaners without verified KYC.
 *
 * Must be used AFTER JwtAuthGuard so that `request.user` is available.
 * Checks the latest kyc_verifications record (highest attempt_number)
 * for the authenticated user. If status !== VERIFIED, access is denied.
 *
 * Only enforced for users with the 'cleaner' role — non-cleaners pass through.
 */
@Injectable()
export class KycVerifiedGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(KycVerification)
    private readonly kycRepository: Repository<KycVerification>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: JwtUserPayload }>();
    const user = await this.findUser(request.user.keycloakId);

    if (!this.isCleaner(user)) {
      return true;
    }

    const latestVerification = await this.findLatestVerification(user.id);
    this.assertVerified(latestVerification);

    return true;
  }

  /** Fetch the user entity by Keycloak ID. */
  private async findUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException(KYC_NOT_VERIFIED_MESSAGE);
    }

    return user;
  }

  /** Check if the user has the cleaner role. */
  private isCleaner(user: User): boolean {
    return user.roles.includes('cleaner');
  }

  /** Query the latest KYC verification record by attempt_number DESC. */
  private async findLatestVerification(userId: string): Promise<KycVerification | null> {
    return this.kycRepository.findOne({
      where: { userId },
      order: { attemptNumber: 'DESC' },
    });
  }

  /** Throw ForbiddenException if verification is missing or not VERIFIED. */
  private assertVerified(verification: KycVerification | null): void {
    if (!verification || verification.status !== KycStatus.VERIFIED) {
      throw new ForbiddenException(KYC_NOT_VERIFIED_MESSAGE);
    }
  }
}

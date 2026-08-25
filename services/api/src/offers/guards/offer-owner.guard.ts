import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Offer } from '../entities/offer.entity';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';

const OFFER_NOT_OWNER_MESSAGE = 'You do not have permission to access this offer';

/**
 * Guard that verifies the authenticated user owns the requested offer.
 *
 * Extracts `offerId` from route params (`:id`), looks up the internal user
 * by keycloakId, then queries the offers table to confirm ownership.
 *
 * Must be used AFTER JwtAuthGuard so that `request.user` is available.
 *
 * This is a SECONDARY defense — the primary enforcement is at the
 * repository/query level where ownership-scoped queries include
 * `WHERE host_id = :userId`.
 */
@Injectable()
export class OfferOwnerGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Offer)
    private readonly offerRepository: Repository<Offer>,
  ) {}

  /**
   * Validate that the authenticated user owns the offer specified in route params.
   * @throws ForbiddenException if the user is not the offer owner or offer not found
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: JwtUserPayload }>();
    const offerId = this.extractOfferId(request);
    const user = await this.findUserByKeycloakId(request.user.keycloakId);

    await this.verifyOwnership(offerId, user.id);

    return true;
  }

  /** Extract the offer ID from route params. */
  private extractOfferId(request: Request): string {
    return request.params['id'] as string;
  }

  /** Look up the internal user by Keycloak ID. */
  private async findUserByKeycloakId(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException(OFFER_NOT_OWNER_MESSAGE);
    }

    return user;
  }

  /** Verify the user owns the offer (host_id matches user.id). */
  private async verifyOwnership(offerId: string, userId: string): Promise<void> {
    const offer = await this.offerRepository.findOne({
      where: {
        id: offerId,
        hostId: userId,
      },
    });

    if (!offer) {
      throw new ForbiddenException(OFFER_NOT_OWNER_MESSAGE);
    }
  }
}

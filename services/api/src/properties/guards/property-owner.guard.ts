import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Property } from '../entities/property.entity';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';

const PROPERTY_NOT_OWNER_MESSAGE = 'You do not have permission to access this property';

/**
 * Guard that verifies the authenticated user owns the requested property.
 *
 * Extracts `propertyId` from route params (`:id`), looks up the internal user
 * by keycloakId, then queries the properties table to confirm ownership.
 *
 * Must be used AFTER JwtAuthGuard so that `request.user` is available.
 *
 * This is a SECONDARY defense — the primary enforcement is at the
 * repository/query level where ALL queries include
 * `WHERE user_id = :userId AND deleted_at IS NULL`.
 */
@Injectable()
export class PropertyOwnerGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: JwtUserPayload }>();
    const propertyId = this.extractPropertyId(request);
    const user = await this.findUserByKeycloakId(request.user.keycloakId);

    await this.verifyOwnership(propertyId, user.id);

    return true;
  }

  /** Extract the property ID from route params. */
  private extractPropertyId(request: Request & { user: JwtUserPayload }): string {
    return request.params.id as string;
  }

  /** Look up the internal user by Keycloak ID. */
  private async findUserByKeycloakId(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException(PROPERTY_NOT_OWNER_MESSAGE);
    }

    return user;
  }

  /** Verify the user owns the property and it is not soft-deleted. */
  private async verifyOwnership(propertyId: string, userId: string): Promise<void> {
    const property = await this.propertyRepository.findOne({
      where: {
        id: propertyId,
        userId,
        deletedAt: null as unknown as Date,
      },
    });

    if (!property) {
      throw new ForbiddenException(PROPERTY_NOT_OWNER_MESSAGE);
    }
  }
}

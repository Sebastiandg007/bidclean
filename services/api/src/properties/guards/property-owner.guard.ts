import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

/**
 * Property owner guard.
 * Extracts propertyId from route params, queries the property
 * WHERE id = :propertyId AND user_id = :userId AND deleted_at IS NULL.
 * Throws ForbiddenException if the authenticated user is not the owner
 * or the property does not exist.
 *
 * This is a SECONDARY defense — the primary enforcement is at the
 * repository/query level where ALL queries include WHERE user_id = :userId.
 */
@Injectable()
export class PropertyOwnerGuard implements CanActivate {
  async canActivate(_context: ExecutionContext): Promise<boolean> {
    // Implementation in Task 6
    return true;
  }
}

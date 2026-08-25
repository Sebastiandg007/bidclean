import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Offer owner guard.
 *
 * Verifies that the authenticated user owns the offer referenced
 * by the :id route parameter. Throws ForbiddenException if not.
 *
 * Applied to all mutation endpoints (publish, cancel) and
 * owner-specific read endpoints (detail, price breakdown).
 */
@Injectable()
export class OfferOwnerGuard implements CanActivate {
  /**
   * Validate offer ownership.
   */
  async canActivate(_context: ExecutionContext): Promise<boolean> {
    // TODO: Implement in Task 13
    return true;
  }
}

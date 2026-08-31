import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtUserPayload } from '../../auth/guards/jwt.types';

/**
 * Authorizes commission-rule administration.
 *
 * The platform has no `admin` role in UserRole yet, so operator access is granted via a
 * configurable allowlist of Keycloak subject ids (`COMMISSION_ADMIN_KEYCLOAK_IDS`, comma-
 * separated). This keeps authorization explicit and configuration-driven (no hardcoded
 * identities, no invented role) until a formal admin role exists. Must run AFTER JwtAuthGuard.
 */
@Injectable()
export class CommissionAdminGuard implements CanActivate {
  private readonly allowlist: Set<string>;

  constructor() {
    this.allowlist = new Set(
      (process.env.COMMISSION_ADMIN_KEYCLOAK_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: JwtUserPayload }>();
    const keycloakId = request.user?.keycloakId;

    if (!keycloakId || !this.allowlist.has(keycloakId)) {
      throw new ForbiddenException('Commission-rule administration requires operator access');
    }
    return true;
  }
}

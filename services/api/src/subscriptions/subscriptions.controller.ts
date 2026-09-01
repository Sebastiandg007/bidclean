import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { User } from '../auth/entities/user.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionView } from './subscriptions.types';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Subscriptions controller.
 *
 * Exposes the authenticated, caller-scoped `GET /subscriptions/me`, returning the
 * server-authoritative entitlement/tier view from the mirror (never another user's data, never
 * prices/payment instruments). Resolves the caller from the JWT (keycloakId -> internal id).
 */
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** GET /subscriptions/me — the caller's active entitlements + tier (self-healing). */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req: AuthenticatedRequest): Promise<SubscriptionView> {
    const user = await this.resolveUser(req.user.keycloakId);
    return this.subscriptions.getMyEntitlements(user.id);
  }

  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    return user;
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../roles/roles.types';
import { PaymentsService } from './payments.service';
import { RefundDto } from './dto/refund.dto';
import { PaymentView, StripeAccountStatus } from './payments.types';

/** Request with the typed JWT user payload attached by the guard */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Payments controller.
 *
 * Host + Cleaner REST endpoints. All require JWT auth. The Stripe webhook lives on a
 * separate controller (authenticated by signature, not JWT). Refunds require an
 * Idempotency-Key header. Role resolution maps keycloakId -> User.
 */
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** POST /payments/connect/onboarding — Cleaner creates/reuses an Express account. */
  @Post('connect/onboarding')
  @HttpCode(HttpStatus.CREATED)
  async startOnboarding(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ onboardingUrl: string }> {
    const cleaner = await this.resolveCleaner(req.user.keycloakId);
    return this.paymentsService.startCleanerOnboarding(cleaner.id);
  }

  /** GET /payments/connect/status — Cleaner reads capability flags. */
  @Get('connect/status')
  @HttpCode(HttpStatus.OK)
  async getAccountStatus(@Req() req: AuthenticatedRequest): Promise<StripeAccountStatus> {
    const cleaner = await this.resolveCleaner(req.user.keycloakId);
    return this.paymentsService.getCleanerAccountStatus(cleaner.id);
  }

  /** GET /payments/offers/:offerId — Host owner or matched Cleaner reads the payment. */
  @Get('offers/:offerId')
  @HttpCode(HttpStatus.OK)
  async getPayment(
    @Req() req: AuthenticatedRequest,
    @Param('offerId') offerId: string,
  ): Promise<PaymentView> {
    const user = await this.resolveHostOrCleaner(req.user.keycloakId);
    return this.paymentsService.getPaymentForOffer(user.id, offerId);
  }

  /** POST /payments/offers/:offerId/refund — Host owner requests a full/partial refund. */
  @Post('offers/:offerId/refund')
  @HttpCode(HttpStatus.OK)
  async refund(
    @Req() req: AuthenticatedRequest,
    @Param('offerId') offerId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: RefundDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PaymentView> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const host = await this.resolveHost(req.user.keycloakId);
    return this.paymentsService.refund(host.id, offerId, { amountCents: dto.amountCents }, key);
  }

  // ─── Auth helpers ──────────────────────────────────────────────────────────

  private requireIdempotencyKey(idempotencyKey?: string): string {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return idempotencyKey;
  }

  private async resolveCleaner(keycloakId: string): Promise<User> {
    const user = await this.findUser(keycloakId);
    if (!user.roles.includes(UserRole.CLEANER)) {
      throw new ForbiddenException('Cleaner role required');
    }
    return user;
  }

  private async resolveHost(keycloakId: string): Promise<User> {
    const user = await this.findUser(keycloakId);
    if (!user.roles.includes(UserRole.HOST)) {
      throw new ForbiddenException('Host role required');
    }
    return user;
  }

  private async resolveHostOrCleaner(keycloakId: string): Promise<User> {
    const user = await this.findUser(keycloakId);
    if (!user.roles.includes(UserRole.HOST) && !user.roles.includes(UserRole.CLEANER)) {
      throw new ForbiddenException('Host or Cleaner role required');
    }
    return user;
  }

  private async findUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    return user;
  }
}

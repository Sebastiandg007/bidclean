import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
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
import { OffersService } from './offers.service';
import { OfferOwnerGuard } from './guards/offer-owner.guard';
import { CreateOfferDto } from './dto/create-offer.dto';
import { PublishOfferDto } from './dto/publish-offer.dto';
import { OfferState } from './offers.types';
import { OFFER_LIST_DEFAULT_PAGE_SIZE } from './offers.constants';

/** Extended request with typed user payload from JWT guard */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Offers controller.
 *
 * Exposes REST endpoints for the offer lifecycle:
 * - POST /offers — create a new offer (DRAFT)
 * - POST /offers/:id/publish — publish an offer (DRAFT → PUBLISHED)
 * - POST /offers/:id/cancel — cancel an offer
 * - GET /offers — list own offers (paginated, filterable by state)
 * - GET /offers/:id — get offer detail with state history
 * - GET /offers/:id/price-breakdown — get price breakdown (Host or Cleaner view)
 *
 * All endpoints require JWT auth. Mutation endpoints require Host role.
 * Owner-specific endpoints additionally use OfferOwnerGuard.
 */
@Controller('offers')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(
    private readonly offersService: OffersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * POST /offers
   * Create a new offer in DRAFT state.
   * Requires Host role. Supports Idempotency-Key header.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CreateOfferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ id: string }> {
    const user = await this.resolveHostUser(req.user.keycloakId);

    return this.offersService.create(user.id, {
      ...(dto as Record<string, unknown>),
      idempotencyKey,
    } as Parameters<OffersService['create']>[1]);
  }

  /**
   * POST /offers/:id/publish
   * Publish an offer (DRAFT → PUBLISHED).
   * Requires Host role + ownership.
   */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OfferOwnerGuard)
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: PublishOfferDto,
  ): Promise<void> {
    const user = await this.resolveHostUser(req.user.keycloakId);

    await this.offersService.publish(id, user.id, {
      favoritesFirst: (dto as { favoritesFirst?: boolean }).favoritesFirst,
    });
  }

  /**
   * POST /offers/:id/cancel
   * Cancel an offer (DRAFT/PUBLISHED/ACTIVE → CANCELLED).
   * Requires Host role + ownership.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OfferOwnerGuard)
  async cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    const user = await this.resolveHostUser(req.user.keycloakId);

    await this.offersService.cancel(id, user.id);
  }

  /**
   * GET /offers
   * List own offers with pagination and state filtering.
   * Requires Host role.
   */
  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query('state') state?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<unknown> {
    const user = await this.resolveHostUser(req.user.keycloakId);

    const filters = {
      state: this.parseStateFilter(state),
      page: this.parsePositiveInt(page, 1),
      pageSize: this.parsePositiveInt(pageSize, OFFER_LIST_DEFAULT_PAGE_SIZE),
    };

    return this.offersService.findByHostId(user.id, filters);
  }

  /**
   * GET /offers/:id
   * Get offer detail with state transition history.
   * Requires Host role + ownership.
   */
  @Get(':id')
  @UseGuards(OfferOwnerGuard)
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<unknown> {
    const user = await this.resolveHostUser(req.user.keycloakId);

    const offer = await this.offersService.findById(id, user.id);

    if (!offer) {
      throw new NotFoundException(`Offer ${id} not found`);
    }

    return offer;
  }

  /**
   * GET /offers/:id/price-breakdown
   * Get price breakdown for an offer (Host or Cleaner view).
   * Requires JWT auth with Host or Cleaner role.
   */
  @Get(':id/price-breakdown')
  async getPriceBreakdown(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<unknown> {
    const user = await this.resolveUserWithRole(req.user.keycloakId);

    return this.offersService.getPriceBreakdown(id, user.id, user.activeRole);
  }

  /**
   * Resolve internal user by keycloakId and verify Host role.
   * @throws ForbiddenException if user not found or lacks Host role.
   */
  private async resolveHostUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    if (!user.roles.includes(UserRole.HOST)) {
      throw new ForbiddenException('Host role required');
    }

    return user;
  }

  /**
   * Resolve internal user by keycloakId and determine their active role.
   * Requires either Host or Cleaner role.
   * @throws ForbiddenException if user not found or lacks valid role.
   */
  private async resolveUserWithRole(
    keycloakId: string,
  ): Promise<User & { activeRole: UserRole }> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const role = this.determineUserRole(user);

    return Object.assign(user, { activeRole: role });
  }

  /** Determine the user's role for price breakdown view. */
  private determineUserRole(user: User): UserRole {
    if (user.activeRole === UserRole.CLEANER && user.roles.includes(UserRole.CLEANER)) {
      return UserRole.CLEANER;
    }

    if (user.roles.includes(UserRole.HOST)) {
      return UserRole.HOST;
    }

    if (user.roles.includes(UserRole.CLEANER)) {
      return UserRole.CLEANER;
    }

    throw new ForbiddenException('Host or Cleaner role required');
  }

  /** Parse state filter from query parameter. */
  private parseStateFilter(state?: string): OfferState | undefined {
    if (!state) return undefined;

    const validStates = Object.values(OfferState) as string[];

    if (validStates.includes(state.toUpperCase())) {
      return state.toUpperCase() as OfferState;
    }

    return undefined;
  }

  /** Parse a positive integer from a query string, or return default. */
  private parsePositiveInt(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }
}

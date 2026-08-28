import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../roles/roles.types';
import { AvailableOffersService } from './available-offers.service';
import { AvailableOffersQueryDto } from './dto/available-offers-query.dto';
import {
  AvailableOffersResponseDto,
  AvailableOffersSnapshotResponseDto,
} from './dto/available-offer-response.dto';

/** Extended request with typed user payload from JWT guard */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Available offers controller.
 *
 * Exposes REST endpoints for the Cleaner's offer radar:
 * - GET /offers/available — paginated, filtered, sorted available offers
 * - GET /offers/available/snapshot — full unpaginated set for WebSocket reconciliation
 *
 * Both endpoints require JWT authentication and Cleaner role.
 * The authenticated Cleaner's ID is extracted from the JWT payload
 * and passed to the service layer for scoped queries.
 *
 * Privacy: These endpoints NEVER expose exact property coordinates,
 * street addresses, or postal codes. Only public_location (approximate)
 * and city-level information reach the client.
 *
 * Rate limiting: The snapshot endpoint is limited to 1 request per 30 seconds
 * per Cleaner (anti-abuse for full-table scan). Returns HTTP 429 when exceeded.
 */
@Controller('offers/available')
@UseGuards(JwtAuthGuard)
export class AvailableOffersController {
  constructor(
    private readonly availableOffersService: AvailableOffersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * GET /offers/available
   *
   * Returns paginated available offers for the authenticated Cleaner.
   * Supports server-side filtering by service type, price range, distance,
   * and scheduled date range. Sorting by distance, price, scheduled time,
   * or publish time.
   *
   * Visibility contract enforced: only ACTIVE offers with SENT delivery
   * status for this Cleaner that haven't expired are returned.
   *
   * @returns Paginated response with offer DTOs and pagination metadata
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getAvailableOffers(
    @Req() req: AuthenticatedRequest,
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    queryDto: AvailableOffersQueryDto,
  ): Promise<AvailableOffersResponseDto> {
    const cleanerId = await this.resolveCleanerId(req.user.keycloakId);

    return this.availableOffersService.getAvailableOffers(cleanerId, queryDto);
  }

  /**
   * GET /offers/available/snapshot
   *
   * Returns the full unpaginated set of available offers for the authenticated
   * Cleaner. Used exclusively for WebSocket reconnection reconciliation.
   *
   * The client replaces its entire local offer collection with this response.
   * Rate-limited: max 1 request per 30 seconds per Cleaner.
   *
   * @returns Full offer set with server syncedAt timestamp
   * @throws HttpException 429 if called more frequently than once per 30 seconds
   */
  @Get('snapshot')
  @HttpCode(HttpStatus.OK)
  async getAvailableOffersSnapshot(
    @Req() req: AuthenticatedRequest,
  ): Promise<AvailableOffersSnapshotResponseDto> {
    const cleanerId = await this.resolveCleanerId(req.user.keycloakId);

    return this.availableOffersService.getAvailableOffersSnapshot(cleanerId);
  }

  /**
   * Resolve the internal Cleaner user ID from the JWT's keycloakId.
   *
   * Verifies that the authenticated user exists and has the Cleaner role.
   * This is the access control enforcement point — only Cleaners can
   * access available offers endpoints.
   *
   * @param keycloakId - Keycloak subject ID from JWT payload
   * @returns Internal user ID (UUID) for the authenticated Cleaner
   * @throws ForbiddenException if user not found or lacks Cleaner role
   */
  private async resolveCleanerId(keycloakId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    if (!user.roles.includes(UserRole.CLEANER)) {
      throw new ForbiddenException('Cleaner role required');
    }

    return user.id;
  }
}

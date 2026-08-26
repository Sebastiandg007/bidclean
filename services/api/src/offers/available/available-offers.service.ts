import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AvailableOffersRepository } from './available-offers.repository';
import { AvailableOffersQueryDto } from './dto/available-offers-query.dto';
import {
  AvailableOfferRow,
  AvailableOffersFilters,
} from './dto/available-offers.types';
import {
  AvailableOfferDto,
  AvailableOffersResponseDto,
  AvailableOffersPaginationDto,
  AvailableOffersSnapshotResponseDto,
  PropertySnapshotDto,
  CleanerPriceBreakdownDto,
  PublicLocationDto,
} from './dto/available-offer-response.dto';

/** Rate limit window for the snapshot endpoint in milliseconds (default: 30000 = 30s) */
const SNAPSHOT_RATE_LIMIT_MS = parseInt(
  process.env.SNAPSHOT_RATE_LIMIT_MS ?? '30000',
  10,
);

/** Urgency threshold in milliseconds (offers within 2 hours are urgent) */
const URGENCY_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Available offers service (business logic layer).
 *
 * Orchestrates the available offers repository to:
 * - Build filter parameters from query DTO + authenticated Cleaner ID
 * - Map raw database rows to privacy-safe response DTOs
 * - Compute pagination metadata (page, limit, total, totalPages)
 * - Enforce rate limiting on the snapshot endpoint (max 1 req/30s per Cleaner)
 *
 * Privacy guarantee: NO private fields (street, postal code, formatted address,
 * access instructions, exact coordinates) are ever exposed in responses.
 * Only public-facing data from property snapshots and the approximate
 * public_location (city-level jittered point) reach the client.
 */
@Injectable()
export class AvailableOffersService {
  private readonly logger = new Logger(AvailableOffersService.name);

  /**
   * In-memory rate limit tracker for the snapshot endpoint.
   * Maps cleanerId → last snapshot request timestamp (epoch ms).
   *
   * In a multi-instance deployment, replace with Redis-based tracking.
   */
  private readonly snapshotLastCallMap = new Map<string, number>();

  constructor(
    private readonly availableOffersRepository: AvailableOffersRepository,
  ) {}

  /**
   * Fetch paginated available offers for the authenticated Cleaner.
   *
   * Builds filter parameters from the validated query DTO and the Cleaner's ID,
   * passes them to the repository, then maps raw rows to the response shape.
   *
   * @param cleanerId - Authenticated Cleaner's user ID (from controller/request context)
   * @param queryDto - Validated query parameters from the request
   * @returns Paginated response with mapped offer DTOs
   */
  async getAvailableOffers(
    cleanerId: string,
    queryDto: AvailableOffersQueryDto,
  ): Promise<AvailableOffersResponseDto> {
    const filters = this.buildFilters(cleanerId, queryDto);

    const { rows, total } = await this.availableOffersRepository.findAvailableOffers(filters);

    const items = rows.map((row) => this.mapRowToDto(row));
    const pagination = this.buildPagination(queryDto.page, queryDto.limit, total);

    const response = new AvailableOffersResponseDto();
    response.items = items;
    response.pagination = pagination;

    this.logger.debug(
      `Returned ${items.length} offers (page ${queryDto.page}/${pagination.totalPages}) for cleaner ${cleanerId}`,
    );

    return response;
  }

  /**
   * Fetch the full unpaginated snapshot of available offers for reconciliation.
   *
   * Used exclusively for WebSocket reconnection reconciliation.
   * Rate-limited: max 1 request per 30 seconds per Cleaner.
   *
   * @param cleanerId - Authenticated Cleaner's user ID
   * @returns Full offer set with server timestamp
   * @throws HttpException 429 if called too frequently
   */
  async getAvailableOffersSnapshot(
    cleanerId: string,
  ): Promise<AvailableOffersSnapshotResponseDto> {
    this.enforceSnapshotRateLimit(cleanerId);

    const { rows } = await this.availableOffersRepository.findAvailableOffersSnapshot(cleanerId);

    const offers = rows.map((row) => this.mapRowToDto(row));

    const response = new AvailableOffersSnapshotResponseDto();
    response.offers = offers;
    response.syncedAt = new Date().toISOString();

    this.logger.debug(
      `Snapshot: returned ${offers.length} offers for cleaner ${cleanerId}`,
    );

    return response;
  }

  /**
   * Build the internal filters object from the query DTO and Cleaner ID.
   * Maps DTO field names to the repository's expected filter interface.
   */
  private buildFilters(
    cleanerId: string,
    queryDto: AvailableOffersQueryDto,
  ): AvailableOffersFilters {
    return {
      cleanerId,
      serviceTypes: queryDto.serviceType,
      minPriceCents: queryDto.minPriceCents,
      maxPriceCents: queryDto.maxPriceCents,
      maxDistanceMeters: queryDto.maxDistanceMeters,
      scheduledBefore: queryDto.scheduledBefore,
      scheduledAfter: queryDto.scheduledAfter,
      sort: queryDto.sort,
      page: queryDto.page,
      limit: queryDto.limit,
    };
  }

  /**
   * Map a raw database row to the response DTO.
   *
   * Privacy: Only includes property snapshot fields (name, type, city, cover photo)
   * and the approximate public location. NO street address, postal code,
   * formatted address, access instructions, or exact coordinates are exposed.
   */
  private mapRowToDto(row: AvailableOfferRow): AvailableOfferDto {
    const propertySnapshot = new PropertySnapshotDto();
    propertySnapshot.name = row.property_name_snapshot;
    propertySnapshot.type = row.property_type_snapshot;
    propertySnapshot.city = row.property_city_snapshot;
    propertySnapshot.coverPhotoUrl = row.property_cover_photo_snapshot;

    const priceBreakdown = new CleanerPriceBreakdownDto();
    priceBreakdown.offeredPriceCents = row.offered_price_cents;
    priceBreakdown.commissionCents = row.cleaner_commission_cents;
    priceBreakdown.payoutCents = row.cleaner_payout_cents;
    priceBreakdown.currency = row.currency;

    const publicLocation = new PublicLocationDto();
    publicLocation.lat = row.public_lat;
    publicLocation.lng = row.public_lng;

    const dto = new AvailableOfferDto();
    dto.offerId = row.offer_id;
    dto.propertySnapshot = propertySnapshot;
    dto.serviceType = row.service_type;
    dto.description = row.description;
    dto.scheduledAt = row.scheduled_at.toISOString();
    dto.timezone = row.timezone;
    dto.estimatedDurationMinutes = row.estimated_duration_minutes;
    dto.priceBreakdown = priceBreakdown;
    dto.distanceMeters = row.distance_meters;
    dto.publishedAt = row.published_at.toISOString();
    dto.isUrgent = this.computeUrgency(row.scheduled_at);
    dto.publicLocation = publicLocation;

    return dto;
  }

  /**
   * Compute whether an offer is urgent (scheduled within 2 hours).
   *
   * This is a point-in-time computation at query time.
   * The client re-derives this locally with a 60-second timer.
   */
  private computeUrgency(scheduledAt: Date): boolean {
    const now = Date.now();
    const scheduledTime = scheduledAt.getTime();
    return scheduledTime <= now + URGENCY_THRESHOLD_MS;
  }

  /**
   * Build pagination metadata from the query parameters and total count.
   */
  private buildPagination(
    page: number,
    limit: number,
    total: number,
  ): AvailableOffersPaginationDto {
    const pagination = new AvailableOffersPaginationDto();
    pagination.page = page;
    pagination.limit = limit;
    pagination.total = total;
    pagination.totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return pagination;
  }

  /**
   * Enforce rate limiting for the snapshot endpoint.
   *
   * Max 1 request per 30 seconds per Cleaner. Throws 429 Too Many Requests
   * if called before the rate limit window has elapsed.
   *
   * @throws HttpException 429 if rate limit exceeded
   */
  private enforceSnapshotRateLimit(cleanerId: string): void {
    const now = Date.now();
    const lastCall = this.snapshotLastCallMap.get(cleanerId);

    if (lastCall !== undefined) {
      const elapsed = now - lastCall;

      if (elapsed < SNAPSHOT_RATE_LIMIT_MS) {
        const retryAfterSeconds = Math.ceil(
          (SNAPSHOT_RATE_LIMIT_MS - elapsed) / 1000,
        );

        this.logger.warn(
          `Snapshot rate limited for cleaner ${cleanerId} — ${retryAfterSeconds}s remaining`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limited. Retry after ${retryAfterSeconds} seconds.`,
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    this.snapshotLastCallMap.set(cleanerId, now);
  }
}

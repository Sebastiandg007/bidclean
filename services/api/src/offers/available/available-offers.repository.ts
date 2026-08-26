import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AvailableOffersSortOption } from './dto/available-offers-query.dto';
import {
  AvailableOffersFilters,
  AvailableOfferRow,
  AvailableOffersQueryResult,
  AvailableOffersSnapshotResult,
} from './dto/available-offers.types';

/**
 * Available offers repository.
 *
 * Executes PostGIS-powered raw SQL queries to retrieve offers visible to a
 * specific Cleaner. Joins `offers` + `offer_deliveries` + `cleaner_profiles`
 * and enforces the visibility contract:
 *   - offer.state = 'ACTIVE'
 *   - offer_deliveries.delivery_status = 'SENT'
 *   - offer_deliveries.cleaner_id = authenticated Cleaner
 *   - offer.scheduled_at > NOW() (not expired)
 *
 * Distance is calculated from the Cleaner's configured work zone center
 * (NOT their live GPS position) using PostGIS ST_Distance.
 *
 * All queries use parameterized placeholders ($1, $2, ...) — never string interpolation.
 */
@Injectable()
export class AvailableOffersRepository {
  private readonly logger = new Logger(AvailableOffersRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Find available offers for a Cleaner with server-side filtering, sorting, and pagination.
   *
   * @param filters - Validated filter parameters from the DTO layer
   * @returns Paginated result with matching offer rows and total count
   */
  async findAvailableOffers(
    filters: AvailableOffersFilters,
  ): Promise<AvailableOffersQueryResult> {
    const { whereClause, params, paramIndex } = this.buildWhereClause(filters);
    const orderByClause = this.buildOrderByClause(filters.sort);

    const offset = (filters.page - 1) * filters.limit;

    const dataQuery = `
      SELECT
        o.id AS offer_id,
        o.property_name_snapshot,
        o.property_type_snapshot,
        o.property_city_snapshot,
        o.property_cover_photo_snapshot,
        o.service_type,
        o.description,
        o.scheduled_at,
        o.timezone,
        o.estimated_duration_minutes,
        o.offered_price_cents,
        o.cleaner_commission_cents,
        o.cleaner_payout_cents,
        o.currency,
        o.published_at,
        ST_Distance(
          o.public_location::geography,
          cp.work_zone_center::geography
        )::integer AS distance_meters,
        (o.scheduled_at <= NOW() + INTERVAL '2 hours') AS is_urgent,
        ST_Y(o.public_location::geometry) AS public_lat,
        ST_X(o.public_location::geometry) AS public_lng
      FROM offers o
      INNER JOIN offer_deliveries od ON od.offer_id = o.id
      INNER JOIN cleaner_profiles cp ON cp.user_id = od.cleaner_id
      ${whereClause}
      ${orderByClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataParams = [...params, filters.limit, offset];

    const countQuery = `
      SELECT COUNT(*)::integer AS total
      FROM offers o
      INNER JOIN offer_deliveries od ON od.offer_id = o.id
      INNER JOIN cleaner_profiles cp ON cp.user_id = od.cleaner_id
      ${whereClause}
    `;

    const [rows, countResult] = await Promise.all([
      this.dataSource.query<AvailableOfferRow[]>(dataQuery, dataParams),
      this.dataSource.query<{ total: number }[]>(countQuery, params),
    ]);

    const total = countResult[0]?.total ?? 0;

    this.logger.debug(
      `Found ${rows.length} available offers (total: ${total}) for cleaner ${filters.cleanerId}`,
    );

    return { rows, total };
  }

  /**
   * Find ALL available offers for a Cleaner without pagination (snapshot).
   * Used exclusively for WebSocket reconnection reconciliation.
   * Same visibility contract as the paginated query but returns the complete set.
   *
   * @param cleanerId - Authenticated Cleaner's user ID
   * @returns All matching offer rows (unpaginated)
   */
  async findAvailableOffersSnapshot(
    cleanerId: string,
  ): Promise<AvailableOffersSnapshotResult> {
    const query = `
      SELECT
        o.id AS offer_id,
        o.property_name_snapshot,
        o.property_type_snapshot,
        o.property_city_snapshot,
        o.property_cover_photo_snapshot,
        o.service_type,
        o.description,
        o.scheduled_at,
        o.timezone,
        o.estimated_duration_minutes,
        o.offered_price_cents,
        o.cleaner_commission_cents,
        o.cleaner_payout_cents,
        o.currency,
        o.published_at,
        ST_Distance(
          o.public_location::geography,
          cp.work_zone_center::geography
        )::integer AS distance_meters,
        (o.scheduled_at <= NOW() + INTERVAL '2 hours') AS is_urgent,
        ST_Y(o.public_location::geometry) AS public_lat,
        ST_X(o.public_location::geometry) AS public_lng
      FROM offers o
      INNER JOIN offer_deliveries od ON od.offer_id = o.id
      INNER JOIN cleaner_profiles cp ON cp.user_id = od.cleaner_id
      WHERE
        od.cleaner_id = $1
        AND od.delivery_status = 'SENT'
        AND o.state = 'ACTIVE'
        AND o.scheduled_at > NOW()
      ORDER BY ST_Distance(
        o.public_location::geography,
        cp.work_zone_center::geography
      ) ASC
    `;

    const rows = await this.dataSource.query<AvailableOfferRow[]>(query, [
      cleanerId,
    ]);

    this.logger.debug(
      `Snapshot: found ${rows.length} available offers for cleaner ${cleanerId}`,
    );

    return { rows };
  }

  /**
   * Build the dynamic WHERE clause with parameterized filters.
   * Core visibility contract is always enforced. Optional filters are applied
   * only when the corresponding parameter is provided (non-undefined).
   *
   * @param filters - Validated filter parameters
   * @returns WHERE clause string, ordered params array, and next param index
   */
  private buildWhereClause(filters: AvailableOffersFilters): {
    whereClause: string;
    params: unknown[];
    paramIndex: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Core visibility contract (always applied)
    conditions.push(`od.cleaner_id = $${paramIndex}`);
    params.push(filters.cleanerId);
    paramIndex++;

    conditions.push(`od.delivery_status = 'SENT'`);
    conditions.push(`o.state = 'ACTIVE'`);
    conditions.push(`o.scheduled_at > NOW()`);

    // Dynamic filters (applied only when provided)
    if (filters.serviceTypes && filters.serviceTypes.length > 0) {
      conditions.push(`o.service_type = ANY($${paramIndex})`);
      params.push(filters.serviceTypes);
      paramIndex++;
    }

    if (filters.minPriceCents !== undefined) {
      conditions.push(`o.cleaner_payout_cents >= $${paramIndex}`);
      params.push(filters.minPriceCents);
      paramIndex++;
    }

    if (filters.maxPriceCents !== undefined) {
      conditions.push(`o.cleaner_payout_cents <= $${paramIndex}`);
      params.push(filters.maxPriceCents);
      paramIndex++;
    }

    if (filters.maxDistanceMeters !== undefined) {
      conditions.push(
        `ST_DWithin(o.public_location::geography, cp.work_zone_center::geography, $${paramIndex})`,
      );
      params.push(filters.maxDistanceMeters);
      paramIndex++;
    }

    if (filters.scheduledBefore !== undefined) {
      conditions.push(`o.scheduled_at <= $${paramIndex}`);
      params.push(filters.scheduledBefore);
      paramIndex++;
    }

    if (filters.scheduledAfter !== undefined) {
      conditions.push(`o.scheduled_at >= $${paramIndex}`);
      params.push(filters.scheduledAfter);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join('\n        AND ')}`;

    return { whereClause, params, paramIndex };
  }

  /**
   * Build the ORDER BY clause based on the selected sort option.
   * Uses a single-column sort expression for each option.
   *
   * @param sort - The validated sort option enum value
   * @returns Complete ORDER BY SQL clause
   */
  private buildOrderByClause(sort: AvailableOffersSortOption): string {
    switch (sort) {
      case AvailableOffersSortOption.DISTANCE_ASC:
        return 'ORDER BY distance_meters ASC';
      case AvailableOffersSortOption.PRICE_DESC:
        return 'ORDER BY o.cleaner_payout_cents DESC';
      case AvailableOffersSortOption.SCHEDULED_ASC:
        return 'ORDER BY o.scheduled_at ASC';
      case AvailableOffersSortOption.PUBLISHED_DESC:
        return 'ORDER BY o.published_at DESC';
      default:
        return 'ORDER BY distance_meters ASC';
    }
  }
}

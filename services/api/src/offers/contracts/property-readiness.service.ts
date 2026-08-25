import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PropertyReadinessInterface,
  PropertyReadinessResult,
  PropertyReadinessFailure,
} from './property-readiness.interface';

/** Active offer states that block new offer creation */
const ACTIVE_OFFER_STATES = ['DRAFT', 'PUBLISHED', 'ACTIVE'] as const;

/**
 * Default implementation of PropertyReadinessCheck for the offers module.
 *
 * Validates a property's eligibility for offer creation by checking:
 * existence, ownership, soft-delete status, photos, location, required fields,
 * and absence of active offers — in that priority order.
 *
 * Uses DataSource for raw SQL queries since it needs cross-table access
 * (properties, property_photos, offers) without depending on other module repositories.
 */
@Injectable()
export class PropertyReadinessService implements PropertyReadinessInterface {
  private readonly logger = new Logger(PropertyReadinessService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Check if a property is ready for an offer to be created.
   *
   * @param propertyId - The property UUID
   * @param hostId - The Host user UUID (for ownership verification)
   * @returns Readiness result with typed reasons array
   */
  async check(propertyId: string, hostId: string): Promise<PropertyReadinessResult> {
    const reasons: PropertyReadinessFailure[] = [];

    const property = await this.findProperty(propertyId);

    if (!property) {
      this.logger.debug(`Property ${propertyId} not found`);
      return { ready: false, reasons: ['NOT_FOUND'] };
    }

    if (property.user_id !== hostId) {
      this.logger.debug(`Property ${propertyId} not owned by host ${hostId}`);
      return { ready: false, reasons: ['NOT_OWNED'] };
    }

    if (property.deleted_at !== null) {
      reasons.push('DELETED');
    }

    const photoCount = await this.countPhotos(propertyId);
    if (photoCount === 0) {
      reasons.push('NO_PHOTOS');
    }

    if (!property.location) {
      reasons.push('INVALID_LOCATION');
    }

    if (this.hasMissingRequiredFields(property)) {
      reasons.push('MISSING_REQUIRED_FIELDS');
    }

    const hasActiveOffer = await this.checkActiveOffer(propertyId);
    if (hasActiveOffer) {
      reasons.push('HAS_ACTIVE_OFFER');
    }

    const ready = reasons.length === 0;

    this.logger.debug(
      `Property readiness check for ${propertyId}: ready=${ready}, reasons=[${reasons.join(', ')}]`,
    );

    return { ready, reasons };
  }

  /**
   * Finds a property by ID including soft-deleted records.
   * Returns null if property does not exist at all.
   */
  private async findProperty(propertyId: string): Promise<PropertyRow | null> {
    const rows = await this.dataSource.query<PropertyRow[]>(
      `SELECT id, user_id, name, type, address_street, address_city,
              address_country, location, square_meters, bathrooms, deleted_at
       FROM properties
       WHERE id = $1`,
      [propertyId],
    );

    return rows.length > 0 ? rows[0] ?? null : null;
  }

  /**
   * Counts photos associated with a property.
   */
  private async countPhotos(propertyId: string): Promise<number> {
    const result = await this.dataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::integer AS count
       FROM property_photos
       WHERE property_id = $1`,
      [propertyId],
    );

    return Number(result[0].count);
  }

  /**
   * Checks if the property has any required fields missing or invalid.
   */
  private hasMissingRequiredFields(property: PropertyRow): boolean {
    if (!property.name || property.name.trim() === '') return true;
    if (!property.type || property.type.trim() === '') return true;
    if (!property.address_street || property.address_street.trim() === '') return true;
    if (!property.address_city || property.address_city.trim() === '') return true;
    if (!property.address_country || property.address_country.trim() === '') return true;
    if (!property.square_meters || Number(property.square_meters) <= 0) return true;
    if (!property.bathrooms || Number(property.bathrooms) < 1) return true;

    return false;
  }

  /**
   * Checks if the property already has an offer in an active state.
   * Uses the same states covered by the uq_one_active_offer_per_property index.
   */
  private async checkActiveOffer(propertyId: string): Promise<boolean> {
    const result = await this.dataSource.query<[{ exists: boolean }]>(
      `SELECT EXISTS(
        SELECT 1 FROM offers
        WHERE property_id = $1
          AND state = ANY($2)
      ) AS exists`,
      [propertyId, ACTIVE_OFFER_STATES],
    );

    return result[0].exists;
  }
}

/** Raw row shape from the properties query */
interface PropertyRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string | null;
  readonly type: string | null;
  readonly address_street: string | null;
  readonly address_city: string | null;
  readonly address_country: string | null;
  readonly location: string | null;
  readonly square_meters: number | null;
  readonly bathrooms: number | null;
  readonly deleted_at: Date | null;
}

import { Injectable, Logger } from '@nestjs/common';
import { PropertiesRepository } from '../properties.repository';
import {
  PropertyReadinessCheck,
  PropertyReadinessResult,
} from './offer-editability.interface';

/** Readiness check reason constants */
export const READINESS_REASONS = {
  PROPERTY_DELETED: 'property_deleted',
  PROPERTY_NOT_FOUND: 'property_not_found',
  MISSING_NAME: 'missing_name',
  MISSING_TYPE: 'missing_type',
  MISSING_ADDRESS_STREET: 'missing_address_street',
  MISSING_ADDRESS_CITY: 'missing_address_city',
  MISSING_ADDRESS_COUNTRY: 'missing_address_country',
  MISSING_LOCATION: 'missing_location',
  INVALID_SQUARE_METERS: 'invalid_square_meters',
  INSUFFICIENT_BATHROOMS: 'insufficient_bathrooms',
  MISSING_PHOTOS: 'missing_photos',
} as const;

/** Minimum photo count required for offer-readiness */
export const MIN_PHOTOS_FOR_READINESS = 1;

/** Minimum square meters for a valid property */
export const MIN_SQUARE_METERS = 0;

/** Minimum bathrooms for a valid property */
export const MIN_BATHROOMS = 1;

/**
 * Default implementation of the PropertyReadinessCheck contract.
 *
 * Determines if a property meets all requirements for offer publishing.
 * This is a CALCULATED state (not stored) — always derived from current data.
 *
 * A property is offer-ready when:
 * 1. deleted_at IS NULL
 * 2. All required fields are populated (name, type, address, location, sqm, bathrooms)
 * 3. At least 1 photo exists in property_photos
 */
@Injectable()
export class DefaultPropertyReadinessCheck implements PropertyReadinessCheck {
  private readonly logger = new Logger(DefaultPropertyReadinessCheck.name);

  constructor(private readonly propertiesRepository: PropertiesRepository) {}

  /**
   * Checks if a property meets all requirements for offer publishing.
   * Returns granular reasons for any missing requirements.
   *
   * @param propertyId - UUID of the property to check
   * @returns Readiness result with reasons if not ready
   */
  async isOfferReady(propertyId: string): Promise<PropertyReadinessResult> {
    const reasons: string[] = [];

    const property = await this.findProperty(propertyId);

    if (!property) {
      return { ready: false, reasons: [READINESS_REASONS.PROPERTY_NOT_FOUND] };
    }

    if (property.deletedAt !== null) {
      reasons.push(READINESS_REASONS.PROPERTY_DELETED);
    }

    this.validateRequiredFields(property, reasons);

    const photoCount = await this.propertiesRepository.countPhotos(propertyId);
    if (photoCount < MIN_PHOTOS_FOR_READINESS) {
      reasons.push(READINESS_REASONS.MISSING_PHOTOS);
    }

    const ready = reasons.length === 0;

    this.logger.debug(
      `Property readiness check for ${propertyId}: ready=${ready}, reasons=[${reasons.join(', ')}]`,
    );

    return { ready, reasons };
  }

  /**
   * Finds a property by ID without ownership constraint.
   * Includes soft-deleted properties so we can report the "deleted" reason.
   */
  private async findProperty(propertyId: string): Promise<PropertyLike | null> {
    return this.propertiesRepository.findOneIncludingDeleted(propertyId);
  }

  /**
   * Validates all required fields are populated on the property.
   * Adds specific reason strings for each missing field.
   */
  private validateRequiredFields(
    property: PropertyLike,
    reasons: string[],
  ): void {
    if (!property.name) {
      reasons.push(READINESS_REASONS.MISSING_NAME);
    }

    if (!property.type) {
      reasons.push(READINESS_REASONS.MISSING_TYPE);
    }

    if (!property.addressStreet) {
      reasons.push(READINESS_REASONS.MISSING_ADDRESS_STREET);
    }

    if (!property.addressCity) {
      reasons.push(READINESS_REASONS.MISSING_ADDRESS_CITY);
    }

    if (!property.addressCountry) {
      reasons.push(READINESS_REASONS.MISSING_ADDRESS_COUNTRY);
    }

    if (!property.location) {
      reasons.push(READINESS_REASONS.MISSING_LOCATION);
    }

    if (!(property.squareMeters > MIN_SQUARE_METERS)) {
      reasons.push(READINESS_REASONS.INVALID_SQUARE_METERS);
    }

    if (!(property.bathrooms >= MIN_BATHROOMS)) {
      reasons.push(READINESS_REASONS.INSUFFICIENT_BATHROOMS);
    }
  }
}

/** Minimal property shape needed for readiness validation */
interface PropertyLike {
  readonly deletedAt: Date | null;
  readonly name: string;
  readonly type: string;
  readonly addressStreet: string;
  readonly addressCity: string;
  readonly addressCountry: string;
  readonly location: string;
  readonly squareMeters: number;
  readonly bathrooms: number;
}

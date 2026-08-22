import { Injectable } from '@nestjs/common';
import { PropertiesRepository } from './properties.repository';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import { OfferEditabilityCheck } from './contracts/offer-editability.interface';

/**
 * Core properties service.
 * Orchestrates property CRUD, photo management coordination,
 * geocoding triggers on address changes, and offer-readiness checks.
 */
@Injectable()
export class PropertiesService implements OfferEditabilityCheck {
  constructor(
    private readonly propertiesRepository: PropertiesRepository,
    private readonly propertyPhotoService: PropertyPhotoService,
    private readonly geocodingService: GeocodingService,
  ) {}

  /**
   * Default implementation of offer-editability contract.
   * Returns editable=true until offer-publishing spec overrides this.
   */
  async canModifyProperty(
    _propertyId: string,
    _fields: string[],
  ): Promise<{ editable: boolean; blockedFields: string[]; reason?: string }> {
    return { editable: true, blockedFields: [] };
  }

  // CRUD and business logic will be implemented in subsequent tasks (11-22)
}

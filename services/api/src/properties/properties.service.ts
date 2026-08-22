import { Inject, Injectable } from '@nestjs/common';
import { PropertiesRepository } from './properties.repository';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import {
  OFFER_EDITABILITY_CHECK,
  OfferEditabilityCheck,
  OfferEditabilityResult,
} from './contracts/offer-editability.interface';

/**
 * Core properties service.
 * Orchestrates property CRUD, photo management coordination,
 * geocoding triggers on address changes, and offer-readiness checks.
 *
 * Delegates editability decisions to the injected OfferEditabilityCheck
 * contract, which defaults to "always editable" until the offer-publishing
 * spec provides a real implementation.
 */
@Injectable()
export class PropertiesService {
  constructor(
    private readonly _propertiesRepository: PropertiesRepository,
    private readonly _propertyPhotoService: PropertyPhotoService,
    private readonly _geocodingService: GeocodingService,
    @Inject(OFFER_EDITABILITY_CHECK)
    private readonly _editabilityCheck: OfferEditabilityCheck,
  ) {}

  /**
   * Checks whether a property can be modified for the given fields.
   * Delegates to the injected OfferEditabilityCheck contract.
   */
  async checkEditability(
    propertyId: string,
    fields: string[],
  ): Promise<OfferEditabilityResult> {
    return this._editabilityCheck.canModifyProperty(propertyId, fields);
  }

  /** @internal Placeholder to satisfy noUnusedLocals until methods are implemented */
  protected get dependencies(): unknown[] {
    return [this._propertiesRepository, this._propertyPhotoService, this._geocodingService];
  }
}

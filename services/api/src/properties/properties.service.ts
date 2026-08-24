import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PropertiesRepository } from './properties.repository';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import {
  OFFER_EDITABILITY_CHECK,
  OfferEditabilityCheck,
  OfferEditabilityResult,
} from './contracts/offer-editability.interface';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyQueryDto } from './dto/property-query.dto';
import { Property } from './entities/property.entity';
import { PROPERTY_LIST_DEFAULT_PAGE_SIZE, LOCATION_SOURCE_VALUE } from './properties.constants';
import {
  LocationSource,
  OwnerPropertyView,
  PaginatedResponse,
  PropertyListItem,
  PropertyPhotoView,
  PropertyType,
  SupportedCountry,
} from './properties.types';

/** Result wrapper for createProperty to distinguish new vs idempotent */
export interface CreatePropertyResult {
  readonly property: Property;
  readonly isNew: boolean;
}

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
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly _propertiesRepository: PropertiesRepository,
    private readonly _propertyPhotoService: PropertyPhotoService,
    private readonly _geocodingService: GeocodingService,
    @Inject(OFFER_EDITABILITY_CHECK)
    private readonly _editabilityCheck: OfferEditabilityCheck,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a new property for a Host user.
   * Supports Idempotency-Key to prevent duplicate creations.
   * Stores the location as a PostGIS geography point via ST_MakePoint.
   *
   * @param userId - Internal user UUID
   * @param dto - Validated property creation data
   * @param idempotencyKey - Optional idempotency key from request header
   * @returns Created property and whether it was newly created
   */
  async createProperty(
    userId: string,
    dto: CreatePropertyDto,
    idempotencyKey?: string,
  ): Promise<CreatePropertyResult> {
    if (idempotencyKey) {
      const existing = await this._propertiesRepository.findByIdempotencyKey(
        userId,
        idempotencyKey,
      );
      if (existing) {
        return { property: existing, isNew: false };
      }
    }

    const property = await this.insertPropertyWithPostGIS(userId, dto);

    if (idempotencyKey) {
      await this.storeIdempotencyKey(userId, property.id, idempotencyKey);
    }

    this.logger.log(`Property created: ${property.id} for user: ${userId}`);
    return { property, isNew: true };
  }

  /**
   * Lists properties owned by a user with pagination, search, and filters.
   * Resolves cover photo URLs and calculates offer-readiness for each item.
   *
   * @param userId - Internal user UUID
   * @param query - Validated query parameters (page, search, type, sort)
   * @returns Paginated list of property summary items
   */
  async listProperties(
    userId: string,
    query: PropertyQueryDto,
  ): Promise<PaginatedResponse<PropertyListItem>> {
    const result = await this._propertiesRepository.findAllByOwner(userId, {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? PROPERTY_LIST_DEFAULT_PAGE_SIZE,
      search: query.search,
      type: query.type,
      sortBy: query.sortBy,
    });

    const items = await Promise.all(
      result.items.map((property) => this.mapToListItem(property)),
    );

    return {
      items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    };
  }

  /**
   * Soft deletes a property after validating no active offers exist.
   * Consults the offer-editability contract before deletion.
   *
   * @param propertyId - UUID of the property to delete
   * @param userId - Owner's internal user UUID
   * @returns true if the property was soft-deleted, false if not found/not owned
   * @throws ConflictException if the property has active offers
   */
  async deleteProperty(propertyId: string, userId: string): Promise<boolean> {
    const editability = await this._editabilityCheck.canModifyProperty(propertyId, ['delete']);

    if (!editability.editable) {
      throw new ConflictException('property.error.has_active_offer');
    }

    const deleted = await this._propertiesRepository.softDelete(propertyId, userId);

    if (deleted) {
      this.logger.log(`Property soft-deleted: ${propertyId} by user: ${userId}`);
    }

    return deleted;
  }

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

  /**
   * Updates an existing property with partial data.
   * Orchestrates: editability check → address/coordinate change detection →
   * geocoding triggers → repository update.
   *
   * - Address field changes trigger forward geocoding to refresh coordinates
   *   (location_source → GEOCODED).
   * - Direct lat/lng coordinate changes update location_source → MANUAL.
   * - Geocoding failures are non-blocking (property still updates, coordinates may not refresh).
   * - OfferEditabilityCheck contract consulted before any changes are applied.
   *
   * @param propertyId - UUID of the property to update
   * @param userId - Owner's internal user UUID
   * @param dto - Validated partial update data
   * @returns Updated property view or null if not found/not owned
   * @throws ConflictException if OfferEditabilityCheck returns editable=false
   * @throws NotFoundException if property not found or not owned
   */
  async updateProperty(
    propertyId: string,
    userId: string,
    dto: UpdatePropertyDto,
  ): Promise<OwnerPropertyView | null> {
    const changedFields = Object.keys(dto).filter(
      (key) => (dto as Record<string, unknown>)[key] !== undefined,
    );

    if (changedFields.length === 0) {
      return this.getPropertyDetail(propertyId, userId);
    }

    const editability = await this.checkEditability(propertyId, changedFields);
    if (!editability.editable) {
      throw new ConflictException({
        message: 'property.error.cannot_edit',
        blockedFields: editability.blockedFields,
        reason: editability.reason,
      });
    }

    const hasAddressChange = this.detectAddressChange(dto);
    const hasCoordinateChange = this.detectCoordinateChange(dto);

    if (hasCoordinateChange) {
      return this.applyCoordinateUpdate(propertyId, userId, dto);
    }

    if (hasAddressChange) {
      return this.applyAddressUpdateWithGeocoding(propertyId, userId, dto);
    }

    return this.applySimpleUpdate(propertyId, userId, dto);
  }

  /**
   * Detects whether the DTO contains address field changes
   * that should trigger forward geocoding.
   */
  private detectAddressChange(dto: UpdatePropertyDto): boolean {
    return Boolean(
      dto.addressStreet ||
      dto.addressCity ||
      dto.addressState !== undefined ||
      dto.addressPostalCode !== undefined ||
      dto.addressCountry,
    );
  }

  /**
   * Detects whether the DTO contains direct coordinate changes (lat/lng)
   * indicating a manual map pin placement.
   */
  private detectCoordinateChange(dto: UpdatePropertyDto): boolean {
    return dto.lat !== undefined || dto.lng !== undefined;
  }

  /**
   * Applies a direct coordinate update (manual map pin move).
   * Sets location_source to MANUAL. Coordinates come from the DTO.
   * Requires both lat and lng to be present for a coordinate update.
   */
  private async applyCoordinateUpdate(
    propertyId: string,
    userId: string,
    dto: UpdatePropertyDto,
  ): Promise<OwnerPropertyView | null> {
    const existing = await this._propertiesRepository.findOneByOwnerWithCoordinates(
      propertyId,
      userId,
    );

    if (!existing) {
      return null;
    }

    const lat = dto.lat ?? existing.lat;
    const lng = dto.lng ?? existing.lng;

    const fields = this.buildUpdateFields(dto);
    fields['locationSource'] = LOCATION_SOURCE_VALUE.MANUAL;

    const updated = await this._propertiesRepository.updatePropertyWithLocation(
      propertyId,
      userId,
      fields,
      { lat, lng },
    );

    if (!updated) {
      return null;
    }

    return this.getPropertyDetail(propertyId, userId);
  }

  /**
   * Applies an address update with forward geocoding trigger.
   * On successful geocoding: updates coordinates + formatted_address + location_source=GEOCODED.
   * On geocoding failure: applies the address update without refreshing coordinates (non-blocking).
   */
  private async applyAddressUpdateWithGeocoding(
    propertyId: string,
    userId: string,
    dto: UpdatePropertyDto,
  ): Promise<OwnerPropertyView | null> {
    const existing = await this._propertiesRepository.findOneByOwnerWithCoordinates(
      propertyId,
      userId,
    );

    if (!existing) {
      return null;
    }

    const addressForGeocoding = this.buildGeocodeAddress(dto, existing);
    const country = dto.addressCountry ?? existing.addressCountry;

    const geocodeResult = await this.attemptForwardGeocode(
      addressForGeocoding,
      country,
      userId,
    );

    const fields = this.buildUpdateFields(dto);

    if (geocodeResult) {
      fields['formattedAddress'] = geocodeResult.formattedAddress;
      fields['locationSource'] = LOCATION_SOURCE_VALUE.GEOCODED;

      const updated = await this._propertiesRepository.updatePropertyWithLocation(
        propertyId,
        userId,
        fields,
        { lat: geocodeResult.lat, lng: geocodeResult.lng },
      );

      if (!updated) {
        return null;
      }
    } else {
      this.logger.warn(
        `Geocoding failed for property ${propertyId} address update — applying address without coordinate refresh`,
      );

      const entityFields = this.buildEntityPartial(fields);
      const updated = await this._propertiesRepository.updateProperty(
        propertyId,
        userId,
        entityFields,
      );

      if (!updated) {
        return null;
      }
    }

    return this.getPropertyDetail(propertyId, userId);
  }

  /**
   * Applies a simple property update (no address or coordinate changes).
   * Uses the standard TypeORM update path.
   */
  private async applySimpleUpdate(
    propertyId: string,
    userId: string,
    dto: UpdatePropertyDto,
  ): Promise<OwnerPropertyView | null> {
    const fields = this.buildUpdateFields(dto);
    const entityFields = this.buildEntityPartial(fields);

    const updated = await this._propertiesRepository.updateProperty(
      propertyId,
      userId,
      entityFields,
    );

    if (!updated) {
      return null;
    }

    return this.getPropertyDetail(propertyId, userId);
  }

  /**
   * Builds a plain object of changed fields from the DTO,
   * excluding lat/lng (handled separately as coordinates).
   */
  private buildUpdateFields(dto: UpdatePropertyDto): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const dtoRecord = dto as Record<string, unknown>;

    const fieldKeys = [
      'name', 'type', 'description',
      'addressStreet', 'addressCity', 'addressState',
      'addressPostalCode', 'addressCountry', 'formattedAddress',
      'squareMeters', 'bedrooms', 'bathrooms', 'floorNumber',
      'hasParking', 'hasElevator', 'specialRequirements',
      'checklistItems', 'accessInstructions',
    ];

    for (const key of fieldKeys) {
      if (dtoRecord[key] !== undefined) {
        fields[key] = dtoRecord[key];
      }
    }

    return fields;
  }

  /**
   * Converts a Record<string, unknown> into a Partial<Property> for TypeORM update.
   */
  private buildEntityPartial(fields: Record<string, unknown>): Partial<Property> {
    const partial: Partial<Property> = {};

    for (const [key, value] of Object.entries(fields)) {
      (partial as Record<string, unknown>)[key] = value;
    }

    return partial;
  }

  /**
   * Constructs the full address string for geocoding from updated + existing fields.
   */
  private buildGeocodeAddress(
    dto: UpdatePropertyDto,
    existing: Property,
  ): string {
    const street = dto.addressStreet ?? existing.addressStreet;
    const city = dto.addressCity ?? existing.addressCity;
    const state = dto.addressState !== undefined
      ? dto.addressState
      : existing.addressState;
    const postalCode = dto.addressPostalCode !== undefined
      ? dto.addressPostalCode
      : existing.addressPostalCode;

    const parts = [street, city, state, postalCode].filter(Boolean);
    return parts.join(', ');
  }

  /**
   * Attempts forward geocoding. Returns null on failure (non-blocking).
   */
  private async attemptForwardGeocode(
    address: string,
    country: string,
    userId: string,
  ): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
    try {
      const result = await this._geocodingService.forwardGeocode(
        { address, country },
        userId,
      );

      if (!result) {
        return null;
      }

      return {
        lat: result.lat,
        lng: result.lng,
        formattedAddress: result.formattedAddress,
      };
    } catch (error) {
      this.logger.warn(
        `Forward geocoding attempt failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Retrieves the full property detail for an owner, including coordinates,
   * photo signed URLs ordered by display_order, and offer-readiness status.
   *
   * @param propertyId - The property UUID
   * @param userId - The owner's internal user UUID
   * @returns Full owner property view, or null if not found/not owned
   */
  async getPropertyDetail(
    propertyId: string,
    userId: string,
  ): Promise<OwnerPropertyView | null> {
    const property = await this._propertiesRepository.findOneByOwnerWithCoordinates(
      propertyId,
      userId,
    );

    if (!property) {
      return null;
    }

    const photos = await this._propertyPhotoService.getPhotosWithUrls(propertyId);
    const photoViews = this.mapPhotosToViews(photos);
    const photoCount = photoViews.length;

    return this.mapToOwnerView(property, photoViews, photoCount);
  }

  /** @internal Dependencies are now actively used by update methods */
  protected get dependencies(): unknown[] {
    return [];
  }

  /**
   * Maps a Property entity to a PropertyListItem with cover photo URL and offer-readiness.
   */
  private async mapToListItem(property: Property): Promise<PropertyListItem> {
    const coverPhotoUrl = await this.resolveCoverPhotoUrl(property.id);
    const photoCount = property.photos?.length ?? 0;

    return {
      id: property.id,
      name: property.name,
      type: property.type as PropertyType,
      city: property.addressCity,
      country: property.addressCountry as SupportedCountry,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      coverPhotoUrl,
      isOfferReady: this.isOfferReady(property, photoCount),
    };
  }

  /** Resolves a signed URL for the cover photo (display_order = 0). Returns null if none. */
  private async resolveCoverPhotoUrl(propertyId: string): Promise<string | null> {
    const coverPhoto = await this._propertiesRepository.getCoverPhoto(propertyId);
    if (!coverPhoto) {
      return null;
    }

    const { url } = await this._propertyPhotoService.getSignedUrl(coverPhoto.storageKey);
    return url;
  }

  /**
   * Calculates offer-readiness: deleted_at IS NULL + required fields populated + at least 1 photo.
   * Required: name, type, address (street, city, country), location, squareMeters, bathrooms >= 1.
   */
  private isOfferReady(property: Property, photoCount: number): boolean {
    if (property.deletedAt !== null) {
      return false;
    }
    if (photoCount < 1) {
      return false;
    }

    return Boolean(
      property.name &&
      property.type &&
      property.addressStreet &&
      property.addressCity &&
      property.addressCountry &&
      property.location &&
      property.squareMeters > 0 &&
      property.bathrooms >= 1,
    );
  }

  /**
   * Inserts a property using raw SQL to properly handle PostGIS ST_MakePoint.
   * TypeORM's save() does not natively handle geography column inserts.
   */
  private async insertPropertyWithPostGIS(
    userId: string,
    dto: CreatePropertyDto,
  ): Promise<Property> {
    const result = await this.dataSource.query(
      `INSERT INTO properties (
        user_id, name, type, description,
        address_street, address_city, address_state, address_postal_code, address_country,
        location, formatted_address, location_source,
        square_meters, bedrooms, bathrooms, floor_number,
        has_parking, has_elevator, special_requirements, checklist_items,
        access_instructions
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        ST_MakePoint($10, $11)::geography, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22
      ) RETURNING *`,
      [
        userId,
        dto.name,
        dto.type,
        dto.description ?? null,
        dto.addressStreet,
        dto.addressCity,
        dto.addressState ?? null,
        dto.addressPostalCode ?? null,
        dto.addressCountry,
        dto.lng,
        dto.lat,
        dto.formattedAddress ?? null,
        dto.locationSource,
        dto.squareMeters,
        dto.bedrooms,
        dto.bathrooms,
        dto.floorNumber ?? null,
        dto.hasParking ?? false,
        dto.hasElevator ?? false,
        dto.specialRequirements ?? [],
        dto.checklistItems ?? [],
        dto.accessInstructions ?? null,
      ],
    );

    const row = result[0];
    return this.mapRowToProperty(row);
  }

  /** Stores an idempotency key record after successful property creation. */
  private async storeIdempotencyKey(
    userId: string,
    propertyId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO property_idempotency_keys (user_id, property_id, idempotency_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      [userId, propertyId, idempotencyKey],
    );
  }

  /** Maps a raw database row to a Property entity shape. */
  private mapRowToProperty(row: Record<string, unknown>): Property {
    const property = new Property();
    property.id = row['id'] as string;
    property.userId = row['user_id'] as string;
    property.name = row['name'] as string;
    property.type = row['type'] as string;
    property.description = (row['description'] as string) ?? null;
    property.addressStreet = row['address_street'] as string;
    property.addressCity = row['address_city'] as string;
    property.addressState = (row['address_state'] as string) ?? null;
    property.addressPostalCode = (row['address_postal_code'] as string) ?? null;
    property.addressCountry = row['address_country'] as string;
    property.location = row['location'] as string;
    property.formattedAddress = (row['formatted_address'] as string) ?? null;
    property.locationSource = row['location_source'] as string;
    property.squareMeters = Number(row['square_meters']);
    property.bedrooms = Number(row['bedrooms']);
    property.bathrooms = Number(row['bathrooms']);
    property.floorNumber = row['floor_number'] != null ? Number(row['floor_number']) : null;
    property.hasParking = row['has_parking'] as boolean;
    property.hasElevator = row['has_elevator'] as boolean;
    property.specialRequirements = (row['special_requirements'] as string[]) ?? [];
    property.checklistItems = (row['checklist_items'] as string[]) ?? [];
    property.accessInstructions = (row['access_instructions'] as string) ?? null;
    property.deletedAt = (row['deleted_at'] as Date) ?? null;
    property.createdAt = row['created_at'] as Date;
    property.updatedAt = row['updated_at'] as Date;
    return property;
  }

  /** Maps photo upload results to the PropertyPhotoView shape. */
  private mapPhotosToViews(
    photos: { id: string; mimeType: string; fileSizeBytes: number; displayOrder: number; signedUrl: string }[],
  ): PropertyPhotoView[] {
    return photos.map((photo) => ({
      id: photo.id,
      url: photo.signedUrl,
      mimeType: photo.mimeType,
      fileSizeBytes: photo.fileSizeBytes,
      displayOrder: photo.displayOrder,
    }));
  }

  /** Maps a Property entity (with extracted coordinates) to the full OwnerPropertyView. */
  private mapToOwnerView(
    property: Property & { lat: number; lng: number },
    photos: PropertyPhotoView[],
    photoCount: number,
  ): OwnerPropertyView {
    return {
      id: property.id,
      userId: property.userId,
      name: property.name,
      type: property.type as PropertyType,
      description: property.description,
      address: {
        street: property.addressStreet,
        city: property.addressCity,
        state: property.addressState,
        postalCode: property.addressPostalCode,
        country: property.addressCountry as SupportedCountry,
      },
      formattedAddress: property.formattedAddress,
      location: { lat: property.lat, lng: property.lng },
      locationSource: property.locationSource as LocationSource,
      dimensions: {
        squareMeters: property.squareMeters,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        floorNumber: property.floorNumber,
      },
      amenities: {
        hasParking: property.hasParking,
        hasElevator: property.hasElevator,
        specialRequirements: property.specialRequirements,
      },
      checklistItems: property.checklistItems,
      accessInstructions: property.accessInstructions,
      photos,
      isOfferReady: this.isOfferReady(property, photoCount),
      createdAt: property.createdAt,
      updatedAt: property.updatedAt,
    };
  }
}

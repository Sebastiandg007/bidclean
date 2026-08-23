import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { Property } from './entities/property.entity';

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
   * Checks whether a property can be modified for the given fields.
   * Delegates to the injected OfferEditabilityCheck contract.
   */
  async checkEditability(
    propertyId: string,
    fields: string[],
  ): Promise<OfferEditabilityResult> {
    return this._editabilityCheck.canModifyProperty(propertyId, fields);
  }

  /** @internal Placeholder to satisfy noUnusedLocals until all methods are implemented */
  protected get dependencies(): unknown[] {
    return [this._propertyPhotoService, this._geocodingService];
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
}

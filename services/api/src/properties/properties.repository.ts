import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { Property } from './entities/property.entity';
import { PropertyPhoto } from './entities/property-photo.entity';
import { PaginatedResponse } from './properties.types';
import {
  PROPERTY_LIST_MAX_PAGE_SIZE,
  ALLOWED_SORT_FIELDS,
} from './properties.constants';

/** Options for paginated property listing */
export interface FindAllByOwnerOptions {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly type?: string;
  readonly sortBy?: string;
}

/**
 * Properties repository.
 * Encapsulates all database queries for the properties module.
 *
 * CRITICAL: All queries enforce WHERE user_id = :userId AND deleted_at IS NULL
 * as the PRIMARY ownership/soft-delete enforcement layer.
 *
 * The dedicated findPublicProperty method uses an explicit column list
 * that NEVER returns address_street, address_state, address_postal_code,
 * formatted_address, location, location_source, or access_instructions.
 */
@Injectable()
export class PropertiesRepository {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(PropertyPhoto)
    private readonly photoRepo: Repository<PropertyPhoto>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Find a single property by ID with ownership enforcement.
   * Returns null if property does not exist, is deleted, or belongs to another user.
   */
  async findOneByOwner(
    propertyId: string,
    userId: string,
  ): Promise<Property | null> {
    return this.propertyRepo.findOne({
      where: {
        id: propertyId,
        userId,
        deletedAt: IsNull(),
      },
      relations: ['photos'],
    });
  }

  /**
   * Find a single property by ID with ownership enforcement and PostGIS coordinate extraction.
   * Uses raw SQL with ST_Y/ST_X to extract lat/lng from the geography column.
   * Returns null if property does not exist, is deleted, or belongs to another user.
   */
  async findOneByOwnerWithCoordinates(
    propertyId: string,
    userId: string,
  ): Promise<(Property & { lat: number; lng: number }) | null> {
    const rows = await this.dataSource.query(
      `SELECT
        p.*,
        ST_Y(p.location::geometry) AS lat,
        ST_X(p.location::geometry) AS lng
      FROM properties p
      WHERE p.id = $1
        AND p.user_id = $2
        AND p.deleted_at IS NULL
      LIMIT 1`,
      [propertyId, userId],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0] as Record<string, unknown>;
    const property = this.mapRawRowToProperty(row);

    return Object.assign(property, {
      lat: Number(row['lat']),
      lng: Number(row['lng']),
    });
  }

  /** Maps a raw database row to a Property entity shape. */
  private mapRawRowToProperty(row: Record<string, unknown>): Property {
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

  /**
   * Find all properties owned by a user with pagination, search, and filters.
   * Enforces WHERE user_id = :userId AND deleted_at IS NULL.
   * Supports text search by name/address (ILIKE), filter by property type,
   * and configurable sorting (default: updated_at DESC).
   */
  async findAllByOwner(
    userId: string,
    options: FindAllByOwnerOptions,
  ): Promise<PaginatedResponse<Property>> {
    const page = Math.max(1, options.page);
    const pageSize = Math.min(
      Math.max(1, options.pageSize),
      PROPERTY_LIST_MAX_PAGE_SIZE,
    );
    const offset = (page - 1) * pageSize;
    const sortField = this.resolveSortField(options.sortBy);

    const qb = this.propertyRepo
      .createQueryBuilder('property')
      .leftJoinAndSelect('property.photos', 'photos')
      .where('property.userId = :userId', { userId })
      .andWhere('property.deletedAt IS NULL');

    if (options.search) {
      qb.andWhere(
        '(property.name ILIKE :search OR property.addressStreet ILIKE :search OR property.addressCity ILIKE :search)',
        { search: `%${options.search}%` },
      );
    }

    if (options.type) {
      qb.andWhere('property.type = :type', { type: options.type });
    }

    qb.orderBy(`property.${sortField}`, 'DESC')
      .skip(offset)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Dedicated public property query with explicit column SELECT.
   * Uses raw SQL to structurally guarantee private fields are NEVER returned.
   *
   * NEVER returns: address_street, address_state, address_postal_code,
   * formatted_address, location, location_source, access_instructions.
   *
   * Only returns: id, name, type, description, city, country,
   * square_meters, bedrooms, bathrooms, floor_number,
   * has_parking, has_elevator, special_requirements, checklist_items + photos.
   */
  async findPublicProperty(propertyId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.dataSource.query(
      `SELECT
        p.id,
        p.name,
        p.type,
        p.description,
        p.address_city AS "addressCity",
        p.address_country AS "addressCountry",
        p.square_meters AS "squareMeters",
        p.bedrooms,
        p.bathrooms,
        p.floor_number AS "floorNumber",
        p.has_parking AS "hasParking",
        p.has_elevator AS "hasElevator",
        p.special_requirements AS "specialRequirements",
        p.checklist_items AS "checklistItems"
      FROM properties p
      WHERE p.id = $1
        AND p.deleted_at IS NULL
      LIMIT 1`,
      [propertyId],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const property = rows[0] as Record<string, unknown>;

    const photos = await this.dataSource.query(
      `SELECT
        pp.id,
        pp.storage_key AS "storageKey",
        pp.mime_type AS "mimeType",
        pp.file_size_bytes AS "fileSizeBytes",
        pp.display_order AS "displayOrder"
      FROM property_photos pp
      WHERE pp.property_id = $1
      ORDER BY pp.display_order ASC`,
      [propertyId],
    );

    property['photos'] = photos || [];

    return property;
  }

  /**
   * Create a new property record.
   * Returns the created property with generated ID and timestamps.
   */
  async createProperty(data: Partial<Property>): Promise<Property> {
    const property = this.propertyRepo.create(data);
    return this.propertyRepo.save(property);
  }

  /**
   * Update a property with ownership enforcement.
   * Only updates the property if it belongs to the specified user and is not soft-deleted.
   * Returns the updated property or null if ownership check fails.
   */
  async updateProperty(
    propertyId: string,
    userId: string,
    data: Partial<Property>,
  ): Promise<Property | null> {
    const result = await this.propertyRepo
      .createQueryBuilder()
      .update(Property)
      .set(data)
      .where('id = :propertyId', { propertyId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('deleted_at IS NULL')
      .execute();

    if (result.affected === 0) {
      return null;
    }

    return this.findOneByOwner(propertyId, userId);
  }

  /**
   * Soft delete a property by setting deleted_at timestamp.
   * Enforces ownership: only the owning user can soft-delete.
   * Returns true if the property was soft-deleted, false if not found/not owned.
   */
  async softDelete(propertyId: string, userId: string): Promise<boolean> {
    const result = await this.propertyRepo
      .createQueryBuilder()
      .update(Property)
      .set({ deletedAt: new Date() })
      .where('id = :propertyId', { propertyId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('deleted_at IS NULL')
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Find a property by idempotency key for duplicate detection.
   * Searches the idempotency lookup table for an existing property
   * created by the same user with the given key.
   */
  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<Property | null> {
    const rows = await this.dataSource.query(
      `SELECT property_id FROM property_idempotency_keys
       WHERE user_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [userId, idempotencyKey],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    return this.findOneByOwner(rows[0].property_id, userId);
  }

  /**
   * Count the number of photos for a given property.
   */
  async countPhotos(propertyId: string): Promise<number> {
    return this.photoRepo.count({
      where: { propertyId },
    });
  }

  /**
   * Get the cover photo (display_order = 0) for a property.
   * Returns null if the property has no photos.
   */
  async getCoverPhoto(propertyId: string): Promise<PropertyPhoto | null> {
    return this.photoRepo.findOne({
      where: { propertyId, displayOrder: 0 },
    });
  }

  /**
   * Resolve and validate the sort field for property listing.
   * Maps snake_case DB column names to camelCase entity property names.
   * Returns a safe property name for TypeORM ORDER BY.
   */
  private resolveSortField(sortBy?: string): string {
    if (
      sortBy &&
      ALLOWED_SORT_FIELDS.includes(sortBy as (typeof ALLOWED_SORT_FIELDS)[number])
    ) {
      const fieldMap: Record<string, string> = {
        updated_at: 'updatedAt',
        created_at: 'createdAt',
        name: 'name',
      };
      return fieldMap[sortBy] ?? 'updatedAt';
    }
    return 'updatedAt';
  }
}

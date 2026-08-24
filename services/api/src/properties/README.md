# Properties Module

## Purpose

Manages property CRUD for Hosts: creation with idempotency, photo management (MinIO AES-256 encryption, transactional ordering), geocoding (Mapbox forward/reverse via server-side proxy), PostGIS spatial storage with location_source tracking, address privacy enforcement via dedicated SELECT queries, and offer-readiness calculation.

## Files

| File | Responsibility |
|------|---------------|
| `properties.module.ts` | NestJS module definition, DI providers, entity registration |
| `properties.controller.ts` | HTTP endpoint routing, guards, DTO validation |
| `properties.service.ts` | Business logic orchestration, validation, offer-readiness |
| `properties.repository.ts` | Database queries with ownership enforcement (WHERE user_id AND deleted_at IS NULL), public view query with explicit column list, pagination |
| `properties.types.ts` | TypeScript type definitions (PaginatedResponse, PropertyType, views) |
| `properties.constants.ts` | Named constants (page sizes, allowed sort fields, supported types/countries) |
| `entities/property.entity.ts` | Property TypeORM entity (PostGIS geography, soft delete, CHECK constraints) |
| `entities/property-photo.entity.ts` | PropertyPhoto entity (transactional ordering, metadata) |
| `photo/property-photo.service.ts` | Photo upload/delete/reorder with MinIO, sharp resize, AES-256 encryption |
| `geocoding/geocoding.service.ts` | Mapbox forward/reverse geocoding proxy with rate limiting |
| `guards/property-owner.guard.ts` | CanActivate guard verifying property ownership |
| `contracts/offer-editability.interface.ts` | OfferEditabilityCheck + PropertyReadinessCheck contracts with DI tokens |
| `contracts/property-readiness.service.ts` | DefaultPropertyReadinessCheck implementation (calculated offer-readiness) |
| `dto/` | Request/response DTOs with class-validator decorators |

## Dependencies

- **TypeORM** — entity management, query builder, repository pattern
- **PostgreSQL + PostGIS** — spatial storage (GEOGRAPHY Point 4326)
- **MinIO** — encrypted object storage for property photos
- **Mapbox Geocoding API v5** — forward and reverse geocoding
- **sharp** — image resizing before storage
- **@nestjs/config** — environment variable access

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/properties` | Create new property (Idempotency-Key) |
| GET | `/properties` | List own properties (paginated, filterable) |
| GET | `/properties/:id` | Get property detail (owner — full data) |
| PATCH | `/properties/:id` | Update property fields |
| DELETE | `/properties/:id` | Soft delete property |
| POST | `/properties/:id/photos` | Upload property photo (Idempotency-Key) |
| DELETE | `/properties/:id/photos/:photoId` | Remove property photo |
| PATCH | `/properties/:id/photos/order` | Reorder photos |
| POST | `/properties/geocode` | Forward geocoding |
| POST | `/properties/reverse-geocode` | Reverse geocoding |
| GET | `/properties/:id/public` | Public property view (Cleaners) |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MINIO_PROPERTY_PHOTOS_BUCKET` | MinIO bucket for property photos | Yes |
| `PROPERTY_PHOTO_MAX_SIZE_MB` | Max photo file size in MB | Yes |
| `PROPERTY_PHOTO_MAX_DIMENSION_PX` | Max photo dimension for resize | Yes |
| `PROPERTY_PHOTO_URL_EXPIRY_SECONDS` | Signed URL TTL | Yes |
| `PROPERTY_MAX_PHOTOS` | Max photos per property | Yes |
| `MAPBOX_ACCESS_TOKEN` | Mapbox API token for geocoding | Yes |
| `PROPERTY_GEOCODING_RATE_LIMIT` | Geocoding requests/min per user | Yes |
| `PROPERTY_MAX_SQM` | Max square meters validation | Yes |
| `PROPERTY_MAX_BEDROOMS` | Max bedrooms validation | Yes |
| `PROPERTY_MAX_BATHROOMS` | Max bathrooms validation | Yes |
| `PROPERTY_MAX_CHECKLIST_ITEMS` | Max checklist items | Yes |
| `PROPERTY_MAX_REQUIREMENTS` | Max special requirements | Yes |

## Key Design Decisions

- **Ownership at query level**: All repository queries enforce `WHERE user_id = :userId AND deleted_at IS NULL` as the PRIMARY defense. The `PropertyOwnerGuard` is a secondary layer.
- **Address privacy via dedicated SELECT**: The `findPublicProperty` method uses raw SQL with an explicit column list that structurally cannot return private fields (street, state, postal code, formatted_address, location, location_source, access_instructions).
- **Parameterized queries**: All raw SQL uses positional parameters ($1, $2) — never string concatenation.
- **Soft delete**: Properties use `deleted_at` timestamp. Partial index ensures only active properties are queried efficiently.
- **Location source tracking**: The `location_source` column records whether coordinates came from geocoding or manual pin placement.
- **Offer-readiness as calculated state**: The `PropertyReadinessCheck` contract (`PROPERTY_READINESS_CHECK` DI token) calculates readiness from current data (not stored). Checks: not deleted, required fields populated, at least 1 photo. Returns granular reasons array for UI feedback. Exported for injection by other modules (e.g., offer-publishing).

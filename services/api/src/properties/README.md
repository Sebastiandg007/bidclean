# Properties Module

## Purpose

Manages property CRUD for Hosts — the physical spaces where cleaning services are performed. Handles creation with idempotency, photo management (MinIO AES-256 encryption, transactional ordering), geocoding (Mapbox forward/reverse via server-side proxy), PostGIS spatial storage with location_source tracking, address privacy enforcement via dedicated SELECT queries, and offer-readiness calculation.

## Files

| File | Responsibility |
|------|---------------|
| `properties.module.ts` | NestJS module registration |
| `properties.controller.ts` | HTTP endpoint routing and guards |
| `properties.service.ts` | Business logic orchestration, delegates editability to injected contract |
| `properties.repository.ts` | Database queries with ownership enforcement |
| `properties.types.ts` | TypeScript type/interface definitions |
| `properties.constants.ts` | Configurable limits, allowed values, defaults |

## Subdirectories

| Directory | Responsibility |
|-----------|---------------|
| `entities/` | TypeORM entity definitions (Property, PropertyPhoto) |
| `dto/` | Request/response validation DTOs |
| `photo/` | Photo upload, resize, storage, ordering service |
| `geocoding/` | Mapbox forward/reverse geocoding proxy |
| `guards/` | PropertyOwnerGuard (ownership verification — secondary defense) |
| `contracts/` | Inter-module interfaces and DI tokens (offer-editability with default provider, property-readiness) |
| `__tests__/` | Unit and integration tests |

## Database Tables

### `properties`
Physical spaces where cleaning services are performed. Uses PostGIS for geospatial storage.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated primary key |
| `user_id` | UUID (FK → users) | Owner reference, CASCADE on delete |
| `name` | VARCHAR(100) | Property name |
| `type` | VARCHAR(30) | Type: apartment, house, office, airbnb, commercial_space, other |
| `description` | TEXT | Optional description |
| `address_street` | VARCHAR(255) | Street address (private) |
| `address_city` | VARCHAR(100) | City |
| `address_state` | VARCHAR(100) | State/province (optional) |
| `address_postal_code` | VARCHAR(20) | Postal code (optional) |
| `address_country` | CHAR(2) | ISO alpha-2 country code |
| `location` | GEOGRAPHY(Point, 4326) | PostGIS point for spatial queries |
| `formatted_address` | VARCHAR(500) | Full formatted address from geocoding (private) |
| `location_source` | VARCHAR(20) | How coordinates were obtained: GEOCODED or MANUAL |
| `square_meters` | NUMERIC(8,2) | Property area (must be > 0) |
| `bedrooms` | INTEGER | Number of bedrooms (≥ 0) |
| `bathrooms` | INTEGER | Number of bathrooms (≥ 1) |
| `floor_number` | INTEGER | Floor number (optional) |
| `has_parking` | BOOLEAN | Parking availability |
| `has_elevator` | BOOLEAN | Elevator availability |
| `special_requirements` | VARCHAR(100)[] | Special cleaning requirements |
| `checklist_items` | VARCHAR(200)[] | Property-specific checklist |
| `access_instructions` | TEXT | How to access (private, revealed after match) |
| `deleted_at` | TIMESTAMPTZ | Soft delete timestamp (NULL = active) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Indexes:**
- `idx_properties_user` — FK index on `user_id`
- `idx_properties_user_active` — Partial index on `user_id` WHERE `deleted_at IS NULL`
- `idx_properties_location` — GiST index on `location` for spatial queries
- `idx_properties_type` — Partial index on `type` WHERE `deleted_at IS NULL`

**CHECK constraints:** `chk_type`, `chk_country`, `chk_sqm`, `chk_bedrooms`, `chk_bathrooms`, `chk_location_source`

**Migration:** `1700000007000-CreatePropertiesTable.ts`

### `property_photos`
Property images with display ordering and metadata for auditing/validation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated primary key |
| `property_id` | UUID (FK → properties) | Parent property reference, CASCADE on delete |
| `storage_key` | VARCHAR(512) | MinIO object key (UNIQUE) |
| `mime_type` | VARCHAR(50) | Image MIME type for auditing |
| `file_size_bytes` | INTEGER | File size for validation |
| `display_order` | INTEGER | Photo ordering (0-based, contiguous) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Indexes:**
- `idx_property_photos_property` — FK index on `property_id`
- `idx_property_photos_order` — Composite index on `(property_id, display_order)` for ordered queries

**Constraints:** `uq_property_photos_key` (UNIQUE on storage_key), `FK_property_photos_property_id` (FK CASCADE)

**Migration:** `1700000008000-CreatePropertyPhotosTable.ts`

## Dependencies

- **TypeORM** — database access (PostgreSQL + PostGIS)
- **MinIO** — encrypted photo storage (AES-256 server-side)
- **Sharp** — image resize before upload
- **Mapbox Geocoding API v5** — forward/reverse geocoding (server-side proxy)
- **ConfigService** — all env vars (MAPBOX_ACCESS_TOKEN, MINIO_PROPERTY_PHOTOS_BUCKET, etc.)

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/properties` | Create property (Idempotency-Key) |
| GET | `/properties` | List own properties (paginated) |
| GET | `/properties/:id` | Property detail (owner — full) |
| PATCH | `/properties/:id` | Update property fields |
| DELETE | `/properties/:id` | Soft delete property |
| POST | `/properties/:id/photos` | Upload photo (Idempotency-Key) |
| DELETE | `/properties/:id/photos/:photoId` | Remove photo |
| PATCH | `/properties/:id/photos/order` | Reorder photos |
| POST | `/properties/geocode` | Forward geocoding |
| POST | `/properties/reverse-geocode` | Reverse geocoding |
| GET | `/properties/:id/public` | Public view (Cleaners) |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MINIO_PROPERTY_PHOTOS_BUCKET` | MinIO bucket for property photos | Yes |
| `PROPERTY_PHOTO_MAX_SIZE_MB` | Max photo file size | Yes |
| `PROPERTY_MAX_PHOTOS` | Max photos per property | Yes |
| `MAPBOX_ACCESS_TOKEN` | Mapbox API token for geocoding | Yes |
| `PROPERTY_GEOCODING_RATE_LIMIT` | Rate limit per user (requests/min) | Yes |

## How to Run

```bash
# From services/api/
npm run dev

# Run module tests
npm test -- --testPathPattern=properties
```

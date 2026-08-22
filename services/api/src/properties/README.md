# Properties Module

## Purpose

Manages property CRUD for Hosts — the physical spaces where cleaning services are performed. Handles creation with idempotency, photo management (MinIO AES-256 encryption, transactional ordering), geocoding (Mapbox forward/reverse via server-side proxy), PostGIS spatial storage with location_source tracking, address privacy enforcement via dedicated SELECT queries, and offer-readiness calculation.

## Files

| File | Responsibility |
|------|---------------|
| `properties.module.ts` | NestJS module registration |
| `properties.controller.ts` | HTTP endpoint routing and guards |
| `properties.service.ts` | Business logic orchestration, offer-editability contract |
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
| `guards/` | PropertyOwnerGuard (ownership check) |
| `contracts/` | Inter-module interfaces (offer-editability, property-readiness) |
| `__tests__/` | Unit and integration tests |

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
